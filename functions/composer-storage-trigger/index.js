/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// [START composer_trigger]
'use strict';

const fetch = require('node-fetch');
const FormData = require('form-data');

/**
 * Triggered from a message on a Cloud Storage bucket.
 *
 * IAP authorization based on:
 * https://stackoverflow.com/questions/45787676/how-to-authenticate-google-cloud-functions-for-access-to-secure-app-engine-endpo
 * and
 * https://cloud.google.com/iap/docs/authentication-howto
 *
 * @param {!Object} event The Cloud Functions event.
 * @returns {Promise}
 */
exports.triggerDag = async event => {
  // Fill in your Composer environment information here.

  // The project that holds your function
  const PROJECT_ID = 'your-project-id';
  // Navigate to your webserver's login page and get this from the URL
  const CLIENT_ID = 'your-iap-client-id';
  // This should be part of your webserver's URL:
  // {tenant-project-id}.appspot.com
  const WEBSERVER_ID = 'your-tenant-project-id';
  // The name of the DAG you wish to trigger
  const DAG_NAME = 'composer_sample_trigger_response_dag';

  // Other constants
  const WEBSERVER_URL = `https://${WEBSERVER_ID}.appspot.com/api/experimental/dags/${DAG_NAME}/dag_runs`;
  const USER_AGENT = 'gcf-event-trigger';
  const BODY = {conf: JSON.stringify(event.data)};

  // Make the request
  try {
    const iap = await authorizeIap(CLIENT_ID, PROJECT_ID, USER_AGENT);

    return makeIapPostRequest(
      WEBSERVER_URL,
      BODY,
      iap.idToken,
      USER_AGENT,
      iap.jwt
    );
  } catch (err) {
    console.log('baz', err);
    return Promise.reject(err);
  }
};

/**
 * @param {string} clientId The client id associated with the Composer webserver application.
 * @param {string} projectId The id for the project containing the Cloud Function.
 * @param {string} userAgent The user agent string which will be provided with the webserver request.
 */
const authorizeIap = async (clientId, projectId, userAgent) => {
  const SERVICE_ACCOUNT = `${projectId}@appspot.gserviceaccount.com`;
  const JWT_HEADER = Buffer.from(
    JSON.stringify({alg: 'RS256', typ: 'JWT'})
  ).toString('base64');

  let jwt = '';
  let jwtClaimset = '';

  // Obtain an Oauth2 access token for the appspot service account
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/${SERVICE_ACCOUNT}/token`,
    {
      headers: {'User-Agent': userAgent, 'Metadata-Flavor': 'Google'},
    }
  );
  const tokenResponse = res.json();
  if (tokenResponse.error) {
    return Promise.reject(tokenResponse.error);
  }

  const accessToken = tokenResponse.access_token;
  const iat = Math.floor(new Date().getTime() / 1000);
  const claims = {
    iss: SERVICE_ACCOUNT,
    aud: 'https://www.googleapis.com/oauth2/v4/token',
    iat: iat,
    exp: iat + 60,
    target_audience: clientId,
  };
  jwtClaimset = Buffer.from(JSON.stringify(claims)).toString('base64');
  const toSign = [JWT_HEADER, jwtClaimset].join('.');

  const blob = await fetch(
    `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${SERVICE_ACCOUNT}:signBlob`,
    {
      method: 'POST',
      body: JSON.stringify({
        bytesToSign: Buffer.from(toSign).toString('base64'),
      }),
      headers: {
        'User-Agent': userAgent,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  const blobJson = blob.json();
  if (blobJson.error) {
    return Promise.reject(blobJson.error);
  }

  // Request service account signature on header and claimset
  const jwtSignature = blobJson.signature;
  jwt = [JWT_HEADER, jwtClaimset, jwtSignature].join('.');
  const form = new FormData();
  form.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.append('assertion', jwt);

  const token = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST',
    body: form,
  });
  const tokenJson = token.json();
  if (tokenJson.error) {
    return Promise.reject(tokenJson.error);
  }

  return {
    jwt: jwt,
    idToken: tokenJson.id_token,
  };
};

/**
 * @param {string} url The url that the post request targets.
 * @param {string} body The body of the post request.
 * @param {string} idToken Bearer token used to authorize the iap request.
 * @param {string} userAgent The user agent to identify the requester.
 */
const makeIapPostRequest = async (url, body, idToken, userAgent) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': userAgent,
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return res.text().then(body => Promise.reject(body));
  }
};
// [END composer_trigger]
