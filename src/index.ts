import http2 from 'http2';
import fs from 'fs';

import express from 'express';
import jwt from 'jsonwebtoken';

const APP_BUNDLE_ID = '';
const APPLE_TEAM_ID = '';
const P8_KEY_ID = '';

const host = `https://api.sandbox.push.apple.com`;
const apnsTokenInfoFile = `LastApnsToken.json`;

interface ApnsTokenInfo {
    token: string;
    iat: number;
}

let apnsTokenInfo: ApnsTokenInfo | undefined;
let deviceToken = '';

if (fs.existsSync(apnsTokenInfoFile)) {
    apnsTokenInfo = JSON.parse(fs.readFileSync(apnsTokenInfoFile).toString());
}

const key = fs.readFileSync(`apns-test.p8`, 'utf8');
function checkAndUpdateApnsToken() {
    if (apnsTokenInfo && (Date.now() / 1000 - apnsTokenInfo.iat) < 55 * 60) {
        return;
    }

    // Update.
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
        {
            iss: APPLE_TEAM_ID,
            iat: now,
        },
        key,
        {
            header: {
                alg: "ES256",
                kid: P8_KEY_ID,
            }
        }
    );
    apnsTokenInfo = {
        token,
        iat: now,
    };
    fs.writeFileSync(apnsTokenInfoFile, JSON.stringify(apnsTokenInfo));
}

const client = http2.connect(host);

client.on('error', (err) => console.error(err));

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello!');
});

app.post('/regDevice', (req, res) => {
    const body = req.body;
    deviceToken = body.deviceToken;
    console.log(deviceToken);
    res.send('ok');
});

app.get('/notify', async (req, res) => {
    if (deviceToken === '') {
        res.status(400).send(`deviceToken is not initialized!`);
        return;
    }

    checkAndUpdateApnsToken();
    const headers = {
        ':method': 'POST',
        ':scheme': 'https',
        'apns-topic': APP_BUNDLE_ID,
        ':path': `/3/device/${deviceToken}`,
        'authorization': `bearer ${apnsTokenInfo!.token}`,
    };
    const body = {
        "aps": {
            "alert": "hello",
            "sound" : "default",
            "content-available": 1
        }
    };

    const request = client.request(headers);

    let data = '';
    new Promise<void>((resolve, reject) => {
        let status = 0;
        request.on('response', (headers, flags) => {
            for (const name in headers) {
                if (name === ':status') {
                    status = +(headers[name] || '0');
                }
                console.log(`${name}: ${headers[name]}`);
            }
        });

        request.on('end', () => {
            console.log(`\n${data}`);
            request.close();
            if (status >= 400) {
                reject(`Error!`);
            } else {
                resolve();
            }
        });

        request.setEncoding('utf8');
        request.on('data', (chunk) => { data += chunk; });

        request.write(JSON.stringify(body))
        request.end();
    }).then(() => {
        res.send('Done!');
    }).catch((error) => {
        res.status(400).send(JSON.parse(data));
    })
});

app.listen(3000, () => {
    console.log(`Server started!`);
});
