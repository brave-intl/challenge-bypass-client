const Client = require('../index.js');
const fetch = require('node-fetch');

const serverUrl = 'http://localhost:2416';

(async function () {
  let res;

  // make a new issuer
  const issuerName = 'test_issuer' + Math.random().toString().substring(2, 5);
  res = await fetch(serverUrl + '/v1/issuer/', {
    method: 'POST',
    body: JSON.stringify({ name: issuerName, max_tokens: 200 }),
  });

  if (!res.ok) throw new Error(await res.text());

  // get issuers G, H
  res = await fetch(serverUrl + '/v1/issuer/' + issuerName + '/');
  if (!res.ok) throw new Error(await res.text());

  const { G, H } = await res.json();

  // make a new client
  const client = new Client(G, H);
  // generate pre-tokens, and a request to the server to issue signed blinded tokens
  const issueRequest = client.makeIssueRequest(10);

  res = await fetch(serverUrl + '/v1/blindedToken/' + issuerName + '/', {
    method: 'POST',
    body: issueRequest
  })
  if (!res.ok) throw new Error(await res.text());

  const proofAndTokens = await res.json();
  // unblind signed tokens and check the proof
  client.unblindSignedTokens(proofAndTokens);

  for (let i = 0; i < 10; i++) {
    // redeem a token
    const payload = JSON.stringify({ anything: 'goes here', really: Math.random() });
    const {id, requestBody} = client.getRedeemableTokenRequest(payload);
    res = await fetch(serverUrl + '/v1/blindedToken/' + issuerName + '/redemption/', {
      method: 'POST',
      body: requestBody,
    });

    if (!res.ok) throw new Error(await res.text());

    const redeemedPayload = await fetch(serverUrl + '/v1/blindedToken/' + issuerName + '/redemption/?tokenId=' + encodeURIComponent(id));
    console.log('redeemed ' + await redeemedPayload.text());
  }
})();

process.on('unhandledRejection', error => {
  console.log('unhandledRejection', error.message);
});
