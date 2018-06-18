# Challenge Bypass Extension

The Privacy Pass extension allows a user to bypass internet challenge pages on websites supporting Privacy Pass using a 'blind signature' protocol. This extension alleviates the burden of completing large numbers of internet challenges (such as CAPTCHAs) for honest users by allowing tokens to be gained for an initial solution. These tokens can be spent by the extension when future challenges are displayed to prevent human interaction. The 'blind' capability of the protocol that we use means that tokens that are issued by a server cannot be linked to tokens that are later redeemed. An example server implementation that is compatible with this extension is available [here](https://github.com/privacypass/challenge-bypass-server).

The protocol we use is based on a realization of a 'Verifiable, Oblivious Pseudorandom Function' (VOPRF) first established by [Jarecki et al.](https://eprint.iacr.org/2014/650.pdf). For a technical description of the protocol see the [PROTOCOL.md](https://github.com/privacypass/challenge-bypass-extension/blob/master/PROTOCOL.md). 

The protocol has received extensive review and testing, but this extension is a work in progress and we regard all components as beta releases. We welcome contributions from the wider community, and also feel free to notify us of any issues that occur. Pull requests and reviews of the extension detailed here are welcome and encouraged.

Privacy Pass is currently supported by Cloudflare to allow users to redeem validly signed tokens instead of completing CAPTCHA solutions. Clients receive 30 signed tokens for each CAPTCHA that is initially solved.

The extension is compatible with [Chrome](https://chrome.google.com/webstore/detail/privacy-pass/ajhmfdgkijocedmfjonnpjfojldioehi) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/privacy-pass/) (v48+).

### Contents

  * [Stable releases](#stable-releases)
  * [Testing](#testing)
     * [Firefox](#firefox)
     * [Chrome](#chrome)
  * [Plugin overview](#plugin-overview)
     * [Workflow](#workflow)
     * [Message formatting](#message-formatting)
        * [Issuance request](#issuance-request)
        * [Issue response](#issue-response)
        * [Redemption request (privacy pass)](#redemption-request-privacy-pass)
        * [Redemption response](#redemption-response)
  * [Team](#team)
  * [Design](#design)
  * [Cryptography](#cryptography)

## Stable releases

Download the latest stable release of the extension:
- [Chrome](https://chrome.google.com/webstore/detail/privacy-pass/ajhmfdgkijocedmfjonnpjfojldioehi)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/privacy-pass/)

## Testing

### Firefox

- Clone this repository
- Open Firefox and go to `about:debugging`
- Click 'Load Temporary Add-on' button
- Select manifest.json from <your-repos>/challenge-bypass-extension/
- Check extension logo appears in top-right corner and 0 passes are stored (by clicking on it)
- Go to a web page supporting Privacy Pass where internet challenges are displayed (e.g. https://captcha.website)
- Solve CAPTCHA and check that some passes are stored in the extension now
	- captcha.website cannot be bypassed (this is only for gaining passes)
- Go to a new website supporting Privacy Pass that ordinarily displays a challenge
- Check that the website is displayed correctly without human interaction (more than one pass may be spent)
	- No interaction with a CAPTCHA page should occur, for instance

### Chrome

Same as above, except the extension should be loaded at `chrome://extensions` instead.

## Plugin overview

- background.js: Processes the necessary interactions with web-pages directly. Sends messages and processes edge replies

- config.js: Config file containing commitments to edge private key for checking DLEQ proofs

- content.js: (currently unused) Content script for reading page html

- token.js: Constructs issuance and redemption requests (i.e. privacy passes) from stored blinded tokens

- crypto.js: Wrapper for performing various cryptographic operations required for manipulating tokens

- sjcl.js: Local copy of SJCL library

- In the following we may use 'pass' or 'token' interchangeably. In short, a token refers to the random nonce that is blind signed by the edge. 

- A pass refers to the object that the extension sends to the edge in order to bypass an internet challenge. We will safely assume throughout that challenges manifest themselves as CAPTCHAs

### Workflow

We describe a generic workflow where a user attempts to visit multiple webpages protected by proof-of-work challenges (assume CAPTCHAs) supplied by an edge server.

- **edge**: protects origin webpages from malicious activity
- **user/client**: human interacting with a browser
- **plugin**: acts on behalf of user in interaction with edge
- **(blinded) token**: Random EC point that is 'signed' by the edge
- **pass**: redemption request containing token for bypassing CAPTCHA

- Issuing:
	- Browser requests an origin protected by the edge
	- Browser arrives at challenge page (aka CAPTCHA) provided by the edge
	- User solves CAPTCHA
	- User sends CAPTCHA solution back to the edge
	- Browser plugin generates tokens (currently 30) and cryptographically blinds them
	- The plugin adds an ['issue request'](#issuance-request) to the body of the request before it is sent
	- The edge verifies the CAPTCHA solution and signs the tokens before returning them back to the client in the form of a ['issue response'](#issue-response)
	- The plugin disassembles and unblinds the response and stores the signed tokens for future use. It also reloads the origin webpage and gains access (e.g. sending a pass containing the token as below or a single-domain cookie given by the edge)

- Redemption:
	- User visits an origin and a CAPTCHA page is returned
	- The plugin catches the response and gets an unspent blinded token and signature from the store and creates a ['privacy pass'](#redemption-request) 
	- The plugin sets up a new HTTP request with a header `challenge-bypass-token`; with the value set to the value of the pass
	- The edge verifies the redemption request and checks that the pass has not been used before
	- If all is fine, the edge grants the user access to the origin

### Message formatting

We provide a brief overview of the message types that are sent and received by this plugin. These messages are sent in base64 encoding and either within HTTP bodies or within specific headers. In the following `||` will denote concatenation.

#### Issuance request

JSON struct used for sending blinded tokens to be signed by the edge, this message is appended to the body of a request holding a CAPTCHA solution.

- `<blind-token>` is a randomly sampled, blinded elliptic curve point (this point is sent in compressed format as defined in Section 2.3.3 of http://www.secg.org/sec1-v2.pdf). The blind is also randomly sampled with respect to the same group.

- `<contents>` is an array of N `<blind-token>` objects.

- `<Issue-JSON-struct>`:

	```
	{
		"type": "Issue",
		"contents": "<contents>",
	}
	```

- Body contents:
	
	`"blinded-tokens=" || base64.encode(<Issue-JSON-struct>)`

#### Issue response

Marshaled array used for sending signed tokens back to the user. This message is appended to the response body by the edge after a valid CAPTCHA is submitted.

- `<signed-tokens>` is an array of compressed elliptic curve point, as above, that have been 'signed' by the edge. In the VOPRF model the 'signed' point is essentially a commitment to the edge's private key

- `<proof>` is a base64 encoded JSON struct containing the necessary information for carrying out a DLEQ proof verification. In particular it contains response values `R` and `C` for verifying that the key used in signing is the same as the key stored in the commitment files. See [PROTOCOL.md](https://github.com/privacypass/challenge-bypass-extension/blob/master/PROTOCOL.md) for more details.

- `<batch-proof>` is a base64 encoded JSON struct of the form:<sup>2</sup>

	```
	{
		"proof":"<proof>",
	}
	```
<sup>2</sup> Other [VRF implementations](https://datatracker.ietf.org/doc/draft-goldbe-vrf/?include_text=1) use different notation to us. We have tried to coincide as much as possible with these works.

- `<Batch-DLEQ-Resp>`:
	
	`"batch-proof=" || <batch-proof>` 

- Issue response:
	
	`"signatures=" || <signed-tokens> || <Batch-DLEQ-Resp>`

#### Redemption request (privacy pass)

JSON struct sent in a request header to bypass CAPTCHA pages.

- `<token>` is an original token generated by the plugin before.

- `<shared-point>` is the corresponding unblinded, signed point received from the edge. This point is SEC1 encoded.

- `<host>` is the contents of the host header of the original request.

- `<path>` is the HTTP path of the original request.

- `HMAC()` is a HMAC function that uses SHA256 as underlying hash function

- `<derived-key>` is the derived key (computed over `<data> = (<token> || <shared-point>)`) output by:
	
	`HMAC("hash_derive_key", <data>)`

- `<request-binding>` is the output (computed over `<data> = (<derived-key> || <host> || <path>)`) of the following:

	`HMAC("hash_request_binding", <data>)`

- `<Redeem-JSON-struct>` (or privacy pass):

	```
	{
		"type":"Redeem",
		"contents":"<request-binding>"
	}
	```

- Header:

	`"challenge-bypass-token":"<Redeem-JSON-struct>"`


#### Redemption response

Server response header used if errors occur when verifying the privacy pass.

- `<error-resp>` is the error value returned by the privacy pass verifier. Takes the value 5 or 6, where 5 is an edge-side connection error and 6 is a pass verification error.

- Header: 

	`"CF-Chl-Bypass-Resp":"<error-resp>"`

## Team

- [Alex Davidson](https://alxdavids.xyz)
- [Ian Goldberg](https://cs.uwaterloo.ca/~iang/)
- [Nick Sullivan](https://github.com/grittygrease)
- [George Tankersley](https://gtank.cc)
- [Filippo Valsorda](https://github.com/filosottile)

## Design

- [Eric Tsai](https://github.com/eetom)

## Cryptography

Cryptography is implemented using the elliptic-curve library [SJCL](https://github.com/bitwiseshiftleft/sjcl) and compression of points is done in accordance with the standard SEC1. This work uses the NIST standard P256 elliptic curve for performing operations. Third-party implementers should note that the outputs of the hash-to-curve, key derivation, and point encoding functions must match their Go equivalents exactly for interaction with our server implementation. More information about this will be provided when the edge implementation is open-sourced.

## Acknowledgements

The creation of Privacy Pass has been a joint effort by the team made up of George Tankersley, Ian Goldberg, Nick Sullivan, Filippo Valsorda and myself.

We would also like to thank Eric Tsai for creating the logo and extension design, Dan Boneh for helping us develop key parts of the protocol, as well as Peter Wu and Blake Loring for their helpful code reviews. We would also like to acknowledge Sharon Goldberg, Christopher Wood, Peter Eckersley, Brian Warner, Zaki Manian, Tony Arcieri, Prateek Mittal, Zhuotao Liu, Isis Lovecruft, Henry de Valence, Mike Perry, Trevor Perrin, Zi Lin, Justin Paine, Marek Majkowski, Eoin Brady, Aaran McGuire, and many others who were involved in one way or another and whose efforts are appreciated.

