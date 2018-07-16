const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const fetch = require('node-fetch');


const libScripts = [
  "sjcl.js",
  "config.js",
  "crypto.js",
  "tokens.js",
  //"background.js",
  "keccak.js"
];

const libContext = {
  // some hacks to make sjcl use crypto module for seeding
  module: { exports: 1 },
  require: () => crypto,
  // pollyfil base64 encoding functions
  atob: (a) => Buffer.from(a, 'base64').toString('binary'),
  btoa: (b) => Buffer.from(b).toString('base64'),
};
vm.createContext(libContext);

for (const script of libScripts) {
  vm.runInContext(fs.readFileSync(__dirname + '/challenge-bypass-extension/scripts/' + script), libContext);
}

class Client {
  constructor(G, H) {
    if (!G || !H)
      throw new Error("Server G and H are missing");

    this.G = G;
    this.H = H;

    this._generatedTokens = null;
    this._signedTokens = null;
  }

  reset() {
    this._generatedTokens = null;
    this._signedTokens = null;
  }

  _resetLib() {
    libContext.activeG = this.G;
    libContext.activeH = this.H;
  }

  makeIssueRequest(tokensNumber) {
    if (this._generatedTokens) {
      throw new Error("Previously generated tokens exist. Either get them signed by the server, or reset the client.");
    }

    this._resetLib();
    const tokens = libContext.GenerateNewTokens(tokensNumber);
    this._generatedTokens = tokens;
    const request = libContext.BuildIssueRequest(tokens);
    return request;
  }

  unblindSignedTokens({tokens, batchProof}) {
    if (!this._generatedTokens)
      throw new Error("No generated unsigned tokens");

    this._resetLib();
    const signedPoints = tokens.map(libContext.sec1DecodePoint);
    if (!libContext.verifyProof(batchProof, this._generatedTokens, signedPoints)) {
      throw new Error("Verification failed");
    }

    this._signedTokens = this._generatedTokens.map((token, i) => ({
      token: token.token,
      point: signedPoints[i],
      blind: token.blind,
    }));

    this._generatedTokens = null;
  }

  getRedeemableToken() {
    if (!this._signedTokens)
      throw new Error("No signed tokens");

    const redeemableToken = this._signedTokens.pop();
    if (!redeemableToken) {
      throw new Error("Ran out of signed tokens");
    }

    return redeemableToken;
  }

  getRedeemableTokenRequest(payload) {
    if (typeof payload !== 'string')
      throw new Error('Payload must be a string');

    const redeemableToken = this.getRedeemableToken();

    this._resetLib();
    const id = libContext.btoa(redeemableToken.token);
    const requestBody = libContext.BuildRedeemRequest(redeemableToken, payload);

    return {
      id,
      requestBody,
    };
  }
}

module.exports = Client;
