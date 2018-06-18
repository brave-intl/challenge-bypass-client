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
  vm.runInContext(fs.readFileSync('./challenge-bypass-extension/scripts/' + script), libContext);
}

(async () => {
  const MAX_TOKENS = 300;
  const TOKENS_PER_REQUEST = 30;

  const response = await fetch('http://localhost:2416/v1/registrar/whatever/')
  const registrar = await response.json();
  libContext.activeG = registrar.G;
  libContext.activeH = registrar.H;

  const tokens = libContext.GenerateNewTokens(TOKENS_PER_REQUEST);
  const request = libContext.BuildIssueRequest(tokens);

  const unwrappedRequest = libContext.atob(request);

  const response2 = await fetch('http://localhost:2416/v1/blindedToken/whatever/', {
    body: unwrappedRequest,
    method: 'POST',
  });
  const blindedTokens = await response2.json();
  const batchProof = blindedTokens.pop();

  const signedPoints = blindedTokens.map(libContext.sec1DecodePoint);
  console.log('verify', libContext.verifyProof(batchProof, tokens, signedPoints));
  const tokenObj = {
    token: tokens[0].token,
    point: signedPoints[0],
    blind: tokens[0].blind,
  };

  const atoken = libContext.atob(libContext.BuildRedeemHeader(tokenObj, 'somehost', 'somepath'));

  const response3 = await fetch('http://localhost:2416/v1/blindedToken/whatever/tokenName/', {
    body: atoken,
    method: 'POST',
  });
  console.log(await response3.text());
})();

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});
