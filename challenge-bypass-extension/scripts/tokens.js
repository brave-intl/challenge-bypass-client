/*
 * Handles the creation of 'privacy passes' for bypassing CAPTCHAs
 * A pass is an object containing a token for signing/redemption
 *
 * @main_author: George Tankersley
 * @other_contribs: Alex Davidson
 */

/*global sjcl*/
/* exported CreateBlindToken */
/* exported GenerateNewTokens */
/* exported BuildIssueRequest */
/* exported BuildRedeemHeader */
"use strict";


// Creates
// Inputs:
//  none
// Returns:
//  token bytes
//  T sjcl point
//  r blinding factor, sjcl bignum
function CreateBlindToken() {
    let t = newRandomPoint();
    let bpt = blindPoint(t.point);
    return { token: t.token, point: bpt.point, blind: bpt.blind };
}

// returns: array of blind tokens
function GenerateNewTokens(n) {
    let i = 0;
    let tokens = new Array(n);
    for (i = 0; i < tokens.length; i++) {
        tokens[i] = CreateBlindToken();
    }
    return tokens;
}

// Creates an issuance request for the current set of stored tokens.
// For an issuance request, the contents will be a
// list of base64-encoded marshaled curve points. We can transmit compressed
// curve points here because the service code knows how to decompress them, but
// should remember we use uncompressed points for all key derivations.
function BuildIssueRequest(tokens) {
    let contents = [];
    for (var i = 0; i < tokens.length; i++) {
        const encodedPoint = compressPoint(tokens[i].point);
        contents.push(encodedPoint);
    }
    return JSON.stringify({ pretokens: contents});
}

// For a redemption request, the contents will be an object
//  of {t: token preimage, N: HMAC(payload)} where the HMAC
// key is derived from the signed point corresponding to the token preimage.
function BuildRedeemRequest(token, payload) {
    if (typeof payload !== 'string') throw new Error('payload must be a string');

    const sharedPoint = unblindPoint(token.blind, token.point);
    const derivedKey = deriveKey(sharedPoint, token.token);

    // TODO: this could be more efficient, but it's easier to check correctness when everything is bytes
    const payloadBits = sjcl.codec.utf8String.toBits(payload);
    const payloadBytes = sjcl.codec.bytes.fromBits(payloadBits);

    const binding = createRequestBinding(derivedKey, [payloadBytes]);

    return JSON.stringify({ token: { t: btoa(token.token), N: btoa(binding) }, payload: payload });
}


