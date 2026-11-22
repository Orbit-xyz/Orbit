const crypto = require('crypto');

// Merchant request signatures (#364). A merchant signs each state-changing
// request with HMAC-SHA256 over `${timestamp}.${METHOD}.${path}.${body}`, keyed
// with the API key it authenticates with, and sends:
//   X-Orbit-Timestamp: <unix seconds>
//   X-Orbit-Request-Signature: <hex digest, optionally prefixed "sha256=">
// The body is the exact bytes sent, or empty for requests without one.

const SIGNATURE_HEADER = 'x-orbit-request-signature';
const TIMESTAMP_HEADER = 'x-orbit-timestamp';
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const INVALID_REQUEST_SIGNATURE = 'INVALID_REQUEST_SIGNATURE';

// express.json `verify` hook: keep the raw bytes of signed requests, since the
// signature covers the body exactly as sent rather than the parsed JSON.
const captureSignedRawBody = (req, _res, buf) => {
    if (req.headers[SIGNATURE_HEADER]) req.signedRawBody = Buffer.from(buf);
};

const computeRequestSignature = ({ secret, timestamp, method, path, body = '' }) =>
    crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${String(method).toUpperCase()}.${path}.${body}`)
        .digest('hex');

const bearerSecret = (req) => /^Bearer\s+(\S+)\s*$/i.exec(req.get('Authorization') ?? '')?.[1];

const reject = (res, message) => res.status(401).json({ error: message, code: INVALID_REQUEST_SIGNATURE });

const hasUnreadBody = (req) =>
    !req.signedRawBody && (Number(req.get('Content-Length') || 0) > 0 || Boolean(req.get('Transfer-Encoding')));

/**
 * Verifies X-Orbit-Request-Signature. Runs after API key authentication.
 *
 * Unsigned requests pass through unless `isRequired(req)` is true, so existing
 * integrations keep working; a request that carries either header must carry
 * a valid signature.
 */
const requireRequestSignature = ({
    getSecret = bearerSecret,
    isRequired = () => false,
    nowSeconds = () => Math.floor(Date.now() / 1000),
    toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
} = {}) => (req, res, next) => {
    const signature = req.get(SIGNATURE_HEADER);
    const timestamp = req.get(TIMESTAMP_HEADER);

    if (!signature && !timestamp) {
        if (isRequired(req)) return reject(res, 'This endpoint requires X-Orbit-Request-Signature and X-Orbit-Timestamp');
        return next();
    }
    if (!signature || !timestamp) {
        return reject(res, 'X-Orbit-Request-Signature and X-Orbit-Timestamp must be sent together');
    }
    if (!/^\d{1,12}$/.test(timestamp)) return reject(res, 'X-Orbit-Timestamp must be a Unix timestamp in seconds');
    if (Math.abs(nowSeconds() - Number(timestamp)) > toleranceSeconds) {
        return reject(res, `Request timestamp is outside the ${toleranceSeconds / 60} minute tolerance window`);
    }

    const supplied = signature.trim().replace(/^sha256=/i, '');
    if (!/^[0-9a-f]{64}$/i.test(supplied)) return reject(res, 'Malformed request signature');

    const secret = getSecret(req);
    if (!secret) return reject(res, 'No API secret is available to verify the request signature');
    if (hasUnreadBody(req)) return reject(res, 'Signed requests must send a JSON body');

    const expected = computeRequestSignature({
        secret,
        timestamp,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        body: req.signedRawBody ? req.signedRawBody.toString('utf8') : '',
    });
    if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))) {
        return reject(res, 'Request signature does not match');
    }

    req.requestSignatureVerified = true;
    next();
};

module.exports = {
    INVALID_REQUEST_SIGNATURE,
    SIGNATURE_TOLERANCE_SECONDS,
    captureSignedRawBody,
    computeRequestSignature,
    requireRequestSignature,
};
