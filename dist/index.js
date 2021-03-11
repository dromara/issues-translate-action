require('./sourcemap-register.js');module.exports =
/******/ (function(modules, runtime) { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete installedModules[moduleId];
/******/ 		}
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	__webpack_require__.ab = __dirname + "/";
/******/
/******/ 	// the startup function
/******/ 	function startup() {
/******/ 		// Load entry module and return exports
/******/ 		return __webpack_require__(109);
/******/ 	};
/******/
/******/ 	// run startup
/******/ 	return startup();
/******/ })
/************************************************************************/
/******/ ({

/***/ 2:
/***/ (function(module) {

"use strict";

// rfc7231 6.1
const statusCodeCacheableByDefault = new Set([
    200,
    203,
    204,
    206,
    300,
    301,
    404,
    405,
    410,
    414,
    501,
]);

// This implementation does not understand partial responses (206)
const understoodStatuses = new Set([
    200,
    203,
    204,
    300,
    301,
    302,
    303,
    307,
    308,
    404,
    405,
    410,
    414,
    501,
]);

const errorStatusCodes = new Set([
    500,
    502,
    503, 
    504,
]);

const hopByHopHeaders = {
    date: true, // included, because we add Age update Date
    connection: true,
    'keep-alive': true,
    'proxy-authenticate': true,
    'proxy-authorization': true,
    te: true,
    trailer: true,
    'transfer-encoding': true,
    upgrade: true,
};

const excludedFromRevalidationUpdate = {
    // Since the old body is reused, it doesn't make sense to change properties of the body
    'content-length': true,
    'content-encoding': true,
    'transfer-encoding': true,
    'content-range': true,
};

function toNumberOrZero(s) {
    const n = parseInt(s, 10);
    return isFinite(n) ? n : 0;
}

// RFC 5861
function isErrorResponse(response) {
    // consider undefined response as faulty
    if(!response) {
        return true
    }
    return errorStatusCodes.has(response.status);
}

function parseCacheControl(header) {
    const cc = {};
    if (!header) return cc;

    // TODO: When there is more than one value present for a given directive (e.g., two Expires header fields, multiple Cache-Control: max-age directives),
    // the directive's value is considered invalid. Caches are encouraged to consider responses that have invalid freshness information to be stale
    const parts = header.trim().split(/\s*,\s*/); // TODO: lame parsing
    for (const part of parts) {
        const [k, v] = part.split(/\s*=\s*/, 2);
        cc[k] = v === undefined ? true : v.replace(/^"|"$/g, ''); // TODO: lame unquoting
    }

    return cc;
}

function formatCacheControl(cc) {
    let parts = [];
    for (const k in cc) {
        const v = cc[k];
        parts.push(v === true ? k : k + '=' + v);
    }
    if (!parts.length) {
        return undefined;
    }
    return parts.join(', ');
}

module.exports = class CachePolicy {
    constructor(
        req,
        res,
        {
            shared,
            cacheHeuristic,
            immutableMinTimeToLive,
            ignoreCargoCult,
            _fromObject,
        } = {}
    ) {
        if (_fromObject) {
            this._fromObject(_fromObject);
            return;
        }

        if (!res || !res.headers) {
            throw Error('Response headers missing');
        }
        this._assertRequestHasHeaders(req);

        this._responseTime = this.now();
        this._isShared = shared !== false;
        this._cacheHeuristic =
            undefined !== cacheHeuristic ? cacheHeuristic : 0.1; // 10% matches IE
        this._immutableMinTtl =
            undefined !== immutableMinTimeToLive
                ? immutableMinTimeToLive
                : 24 * 3600 * 1000;

        this._status = 'status' in res ? res.status : 200;
        this._resHeaders = res.headers;
        this._rescc = parseCacheControl(res.headers['cache-control']);
        this._method = 'method' in req ? req.method : 'GET';
        this._url = req.url;
        this._host = req.headers.host;
        this._noAuthorization = !req.headers.authorization;
        this._reqHeaders = res.headers.vary ? req.headers : null; // Don't keep all request headers if they won't be used
        this._reqcc = parseCacheControl(req.headers['cache-control']);

        // Assume that if someone uses legacy, non-standard uncecessary options they don't understand caching,
        // so there's no point stricly adhering to the blindly copy&pasted directives.
        if (
            ignoreCargoCult &&
            'pre-check' in this._rescc &&
            'post-check' in this._rescc
        ) {
            delete this._rescc['pre-check'];
            delete this._rescc['post-check'];
            delete this._rescc['no-cache'];
            delete this._rescc['no-store'];
            delete this._rescc['must-revalidate'];
            this._resHeaders = Object.assign({}, this._resHeaders, {
                'cache-control': formatCacheControl(this._rescc),
            });
            delete this._resHeaders.expires;
            delete this._resHeaders.pragma;
        }

        // When the Cache-Control header field is not present in a request, caches MUST consider the no-cache request pragma-directive
        // as having the same effect as if "Cache-Control: no-cache" were present (see Section 5.2.1).
        if (
            res.headers['cache-control'] == null &&
            /no-cache/.test(res.headers.pragma)
        ) {
            this._rescc['no-cache'] = true;
        }
    }

    now() {
        return Date.now();
    }

    storable() {
        // The "no-store" request directive indicates that a cache MUST NOT store any part of either this request or any response to it.
        return !!(
            !this._reqcc['no-store'] &&
            // A cache MUST NOT store a response to any request, unless:
            // The request method is understood by the cache and defined as being cacheable, and
            ('GET' === this._method ||
                'HEAD' === this._method ||
                ('POST' === this._method && this._hasExplicitExpiration())) &&
            // the response status code is understood by the cache, and
            understoodStatuses.has(this._status) &&
            // the "no-store" cache directive does not appear in request or response header fields, and
            !this._rescc['no-store'] &&
            // the "private" response directive does not appear in the response, if the cache is shared, and
            (!this._isShared || !this._rescc.private) &&
            // the Authorization header field does not appear in the request, if the cache is shared,
            (!this._isShared ||
                this._noAuthorization ||
                this._allowsStoringAuthenticated()) &&
            // the response either:
            // contains an Expires header field, or
            (this._resHeaders.expires ||
                // contains a max-age response directive, or
                // contains a s-maxage response directive and the cache is shared, or
                // contains a public response directive.
                this._rescc['max-age'] ||
                (this._isShared && this._rescc['s-maxage']) ||
                this._rescc.public ||
                // has a status code that is defined as cacheable by default
                statusCodeCacheableByDefault.has(this._status))
        );
    }

    _hasExplicitExpiration() {
        // 4.2.1 Calculating Freshness Lifetime
        return (
            (this._isShared && this._rescc['s-maxage']) ||
            this._rescc['max-age'] ||
            this._resHeaders.expires
        );
    }

    _assertRequestHasHeaders(req) {
        if (!req || !req.headers) {
            throw Error('Request headers missing');
        }
    }

    satisfiesWithoutRevalidation(req) {
        this._assertRequestHasHeaders(req);

        // When presented with a request, a cache MUST NOT reuse a stored response, unless:
        // the presented request does not contain the no-cache pragma (Section 5.4), nor the no-cache cache directive,
        // unless the stored response is successfully validated (Section 4.3), and
        const requestCC = parseCacheControl(req.headers['cache-control']);
        if (requestCC['no-cache'] || /no-cache/.test(req.headers.pragma)) {
            return false;
        }

        if (requestCC['max-age'] && this.age() > requestCC['max-age']) {
            return false;
        }

        if (
            requestCC['min-fresh'] &&
            this.timeToLive() < 1000 * requestCC['min-fresh']
        ) {
            return false;
        }

        // the stored response is either:
        // fresh, or allowed to be served stale
        if (this.stale()) {
            const allowsStale =
                requestCC['max-stale'] &&
                !this._rescc['must-revalidate'] &&
                (true === requestCC['max-stale'] ||
                    requestCC['max-stale'] > this.age() - this.maxAge());
            if (!allowsStale) {
                return false;
            }
        }

        return this._requestMatches(req, false);
    }

    _requestMatches(req, allowHeadMethod) {
        // The presented effective request URI and that of the stored response match, and
        return (
            (!this._url || this._url === req.url) &&
            this._host === req.headers.host &&
            // the request method associated with the stored response allows it to be used for the presented request, and
            (!req.method ||
                this._method === req.method ||
                (allowHeadMethod && 'HEAD' === req.method)) &&
            // selecting header fields nominated by the stored response (if any) match those presented, and
            this._varyMatches(req)
        );
    }

    _allowsStoringAuthenticated() {
        //  following Cache-Control response directives (Section 5.2.2) have such an effect: must-revalidate, public, and s-maxage.
        return (
            this._rescc['must-revalidate'] ||
            this._rescc.public ||
            this._rescc['s-maxage']
        );
    }

    _varyMatches(req) {
        if (!this._resHeaders.vary) {
            return true;
        }

        // A Vary header field-value of "*" always fails to match
        if (this._resHeaders.vary === '*') {
            return false;
        }

        const fields = this._resHeaders.vary
            .trim()
            .toLowerCase()
            .split(/\s*,\s*/);
        for (const name of fields) {
            if (req.headers[name] !== this._reqHeaders[name]) return false;
        }
        return true;
    }

    _copyWithoutHopByHopHeaders(inHeaders) {
        const headers = {};
        for (const name in inHeaders) {
            if (hopByHopHeaders[name]) continue;
            headers[name] = inHeaders[name];
        }
        // 9.1.  Connection
        if (inHeaders.connection) {
            const tokens = inHeaders.connection.trim().split(/\s*,\s*/);
            for (const name of tokens) {
                delete headers[name];
            }
        }
        if (headers.warning) {
            const warnings = headers.warning.split(/,/).filter(warning => {
                return !/^\s*1[0-9][0-9]/.test(warning);
            });
            if (!warnings.length) {
                delete headers.warning;
            } else {
                headers.warning = warnings.join(',').trim();
            }
        }
        return headers;
    }

    responseHeaders() {
        const headers = this._copyWithoutHopByHopHeaders(this._resHeaders);
        const age = this.age();

        // A cache SHOULD generate 113 warning if it heuristically chose a freshness
        // lifetime greater than 24 hours and the response's age is greater than 24 hours.
        if (
            age > 3600 * 24 &&
            !this._hasExplicitExpiration() &&
            this.maxAge() > 3600 * 24
        ) {
            headers.warning =
                (headers.warning ? `${headers.warning}, ` : '') +
                '113 - "rfc7234 5.5.4"';
        }
        headers.age = `${Math.round(age)}`;
        headers.date = new Date(this.now()).toUTCString();
        return headers;
    }

    /**
     * Value of the Date response header or current time if Date was invalid
     * @return timestamp
     */
    date() {
        const serverDate = Date.parse(this._resHeaders.date);
        if (isFinite(serverDate)) {
            return serverDate;
        }
        return this._responseTime;
    }

    /**
     * Value of the Age header, in seconds, updated for the current time.
     * May be fractional.
     *
     * @return Number
     */
    age() {
        let age = this._ageValue();

        const residentTime = (this.now() - this._responseTime) / 1000;
        return age + residentTime;
    }

    _ageValue() {
        return toNumberOrZero(this._resHeaders.age);
    }

    /**
     * Value of applicable max-age (or heuristic equivalent) in seconds. This counts since response's `Date`.
     *
     * For an up-to-date value, see `timeToLive()`.
     *
     * @return Number
     */
    maxAge() {
        if (!this.storable() || this._rescc['no-cache']) {
            return 0;
        }

        // Shared responses with cookies are cacheable according to the RFC, but IMHO it'd be unwise to do so by default
        // so this implementation requires explicit opt-in via public header
        if (
            this._isShared &&
            (this._resHeaders['set-cookie'] &&
                !this._rescc.public &&
                !this._rescc.immutable)
        ) {
            return 0;
        }

        if (this._resHeaders.vary === '*') {
            return 0;
        }

        if (this._isShared) {
            if (this._rescc['proxy-revalidate']) {
                return 0;
            }
            // if a response includes the s-maxage directive, a shared cache recipient MUST ignore the Expires field.
            if (this._rescc['s-maxage']) {
                return toNumberOrZero(this._rescc['s-maxage']);
            }
        }

        // If a response includes a Cache-Control field with the max-age directive, a recipient MUST ignore the Expires field.
        if (this._rescc['max-age']) {
            return toNumberOrZero(this._rescc['max-age']);
        }

        const defaultMinTtl = this._rescc.immutable ? this._immutableMinTtl : 0;

        const serverDate = this.date();
        if (this._resHeaders.expires) {
            const expires = Date.parse(this._resHeaders.expires);
            // A cache recipient MUST interpret invalid date formats, especially the value "0", as representing a time in the past (i.e., "already expired").
            if (Number.isNaN(expires) || expires < serverDate) {
                return 0;
            }
            return Math.max(defaultMinTtl, (expires - serverDate) / 1000);
        }

        if (this._resHeaders['last-modified']) {
            const lastModified = Date.parse(this._resHeaders['last-modified']);
            if (isFinite(lastModified) && serverDate > lastModified) {
                return Math.max(
                    defaultMinTtl,
                    ((serverDate - lastModified) / 1000) * this._cacheHeuristic
                );
            }
        }

        return defaultMinTtl;
    }

    timeToLive() {
        const age = this.maxAge() - this.age();
        const staleIfErrorAge = age + toNumberOrZero(this._rescc['stale-if-error']);
        const staleWhileRevalidateAge = age + toNumberOrZero(this._rescc['stale-while-revalidate']);
        return Math.max(0, age, staleIfErrorAge, staleWhileRevalidateAge) * 1000;
    }

    stale() {
        return this.maxAge() <= this.age();
    }

    _useStaleIfError() {
        return this.maxAge() + toNumberOrZero(this._rescc['stale-if-error']) > this.age();
    }

    useStaleWhileRevalidate() {
        return this.maxAge() + toNumberOrZero(this._rescc['stale-while-revalidate']) > this.age();
    }

    static fromObject(obj) {
        return new this(undefined, undefined, { _fromObject: obj });
    }

    _fromObject(obj) {
        if (this._responseTime) throw Error('Reinitialized');
        if (!obj || obj.v !== 1) throw Error('Invalid serialization');

        this._responseTime = obj.t;
        this._isShared = obj.sh;
        this._cacheHeuristic = obj.ch;
        this._immutableMinTtl =
            obj.imm !== undefined ? obj.imm : 24 * 3600 * 1000;
        this._status = obj.st;
        this._resHeaders = obj.resh;
        this._rescc = obj.rescc;
        this._method = obj.m;
        this._url = obj.u;
        this._host = obj.h;
        this._noAuthorization = obj.a;
        this._reqHeaders = obj.reqh;
        this._reqcc = obj.reqcc;
    }

    toObject() {
        return {
            v: 1,
            t: this._responseTime,
            sh: this._isShared,
            ch: this._cacheHeuristic,
            imm: this._immutableMinTtl,
            st: this._status,
            resh: this._resHeaders,
            rescc: this._rescc,
            m: this._method,
            u: this._url,
            h: this._host,
            a: this._noAuthorization,
            reqh: this._reqHeaders,
            reqcc: this._reqcc,
        };
    }

    /**
     * Headers for sending to the origin server to revalidate stale response.
     * Allows server to return 304 to allow reuse of the previous response.
     *
     * Hop by hop headers are always stripped.
     * Revalidation headers may be added or removed, depending on request.
     */
    revalidationHeaders(incomingReq) {
        this._assertRequestHasHeaders(incomingReq);
        const headers = this._copyWithoutHopByHopHeaders(incomingReq.headers);

        // This implementation does not understand range requests
        delete headers['if-range'];

        if (!this._requestMatches(incomingReq, true) || !this.storable()) {
            // revalidation allowed via HEAD
            // not for the same resource, or wasn't allowed to be cached anyway
            delete headers['if-none-match'];
            delete headers['if-modified-since'];
            return headers;
        }

        /* MUST send that entity-tag in any cache validation request (using If-Match or If-None-Match) if an entity-tag has been provided by the origin server. */
        if (this._resHeaders.etag) {
            headers['if-none-match'] = headers['if-none-match']
                ? `${headers['if-none-match']}, ${this._resHeaders.etag}`
                : this._resHeaders.etag;
        }

        // Clients MAY issue simple (non-subrange) GET requests with either weak validators or strong validators. Clients MUST NOT use weak validators in other forms of request.
        const forbidsWeakValidators =
            headers['accept-ranges'] ||
            headers['if-match'] ||
            headers['if-unmodified-since'] ||
            (this._method && this._method != 'GET');

        /* SHOULD send the Last-Modified value in non-subrange cache validation requests (using If-Modified-Since) if only a Last-Modified value has been provided by the origin server.
        Note: This implementation does not understand partial responses (206) */
        if (forbidsWeakValidators) {
            delete headers['if-modified-since'];

            if (headers['if-none-match']) {
                const etags = headers['if-none-match']
                    .split(/,/)
                    .filter(etag => {
                        return !/^\s*W\//.test(etag);
                    });
                if (!etags.length) {
                    delete headers['if-none-match'];
                } else {
                    headers['if-none-match'] = etags.join(',').trim();
                }
            }
        } else if (
            this._resHeaders['last-modified'] &&
            !headers['if-modified-since']
        ) {
            headers['if-modified-since'] = this._resHeaders['last-modified'];
        }

        return headers;
    }

    /**
     * Creates new CachePolicy with information combined from the previews response,
     * and the new revalidation response.
     *
     * Returns {policy, modified} where modified is a boolean indicating
     * whether the response body has been modified, and old cached body can't be used.
     *
     * @return {Object} {policy: CachePolicy, modified: Boolean}
     */
    revalidatedPolicy(request, response) {
        this._assertRequestHasHeaders(request);
        if(this._useStaleIfError() && isErrorResponse(response)) {  // I consider the revalidation request unsuccessful
          return {
            modified: false,
            matches: false,
            policy: this,
          };
        }
        if (!response || !response.headers) {
            throw Error('Response headers missing');
        }

        // These aren't going to be supported exactly, since one CachePolicy object
        // doesn't know about all the other cached objects.
        let matches = false;
        if (response.status !== undefined && response.status != 304) {
            matches = false;
        } else if (
            response.headers.etag &&
            !/^\s*W\//.test(response.headers.etag)
        ) {
            // "All of the stored responses with the same strong validator are selected.
            // If none of the stored responses contain the same strong validator,
            // then the cache MUST NOT use the new response to update any stored responses."
            matches =
                this._resHeaders.etag &&
                this._resHeaders.etag.replace(/^\s*W\//, '') ===
                    response.headers.etag;
        } else if (this._resHeaders.etag && response.headers.etag) {
            // "If the new response contains a weak validator and that validator corresponds
            // to one of the cache's stored responses,
            // then the most recent of those matching stored responses is selected for update."
            matches =
                this._resHeaders.etag.replace(/^\s*W\//, '') ===
                response.headers.etag.replace(/^\s*W\//, '');
        } else if (this._resHeaders['last-modified']) {
            matches =
                this._resHeaders['last-modified'] ===
                response.headers['last-modified'];
        } else {
            // If the new response does not include any form of validator (such as in the case where
            // a client generates an If-Modified-Since request from a source other than the Last-Modified
            // response header field), and there is only one stored response, and that stored response also
            // lacks a validator, then that stored response is selected for update.
            if (
                !this._resHeaders.etag &&
                !this._resHeaders['last-modified'] &&
                !response.headers.etag &&
                !response.headers['last-modified']
            ) {
                matches = true;
            }
        }

        if (!matches) {
            return {
                policy: new this.constructor(request, response),
                // Client receiving 304 without body, even if it's invalid/mismatched has no option
                // but to reuse a cached body. We don't have a good way to tell clients to do
                // error recovery in such case.
                modified: response.status != 304,
                matches: false,
            };
        }

        // use other header fields provided in the 304 (Not Modified) response to replace all instances
        // of the corresponding header fields in the stored response.
        const headers = {};
        for (const k in this._resHeaders) {
            headers[k] =
                k in response.headers && !excludedFromRevalidationUpdate[k]
                    ? response.headers[k]
                    : this._resHeaders[k];
        }

        const newResponse = Object.assign({}, response, {
            status: this._status,
            method: this._method,
            headers,
        });
        return {
            policy: new this.constructor(request, newResponse, {
                shared: this._isShared,
                cacheHeuristic: this._cacheHeuristic,
                immutableMinTimeToLive: this._immutableMinTtl,
            }),
            modified: false,
            matches: true,
        };
    }
};


/***/ }),

/***/ 4:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const Readable = __webpack_require__(413).Readable;
const lowercaseKeys = __webpack_require__(662);

class Response extends Readable {
	constructor(statusCode, headers, body, url) {
		if (typeof statusCode !== 'number') {
			throw new TypeError('Argument `statusCode` should be a number');
		}
		if (typeof headers !== 'object') {
			throw new TypeError('Argument `headers` should be an object');
		}
		if (!(body instanceof Buffer)) {
			throw new TypeError('Argument `body` should be a buffer');
		}
		if (typeof url !== 'string') {
			throw new TypeError('Argument `url` should be a string');
		}

		super();
		this.statusCode = statusCode;
		this.headers = lowercaseKeys(headers);
		this.body = body;
		this.url = url;
	}

	_read() {
		this.push(this.body);
		this.push(null);
	}
}

module.exports = Response;


/***/ }),

/***/ 16:
/***/ (function(module) {

module.exports = require("tls");

/***/ }),

/***/ 21:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
function default_1(from, to, events) {
    const fns = {};
    for (const event of events) {
        fns[event] = (...args) => {
            to.emit(event, ...args);
        };
        from.on(event, fns[event]);
    }
    return () => {
        for (const event of events) {
            from.off(event, fns[event]);
        }
    };
}
exports.default = default_1;


/***/ }),

/***/ 26:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const is_1 = __webpack_require__(678);
exports.default = (url) => {
    // Cast to URL
    url = url;
    const options = {
        protocol: url.protocol,
        hostname: is_1.default.string(url.hostname) && url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
        host: url.host,
        hash: url.hash,
        search: url.search,
        pathname: url.pathname,
        href: url.href,
        path: `${url.pathname || ''}${url.search || ''}`
    };
    if (is_1.default.string(url.port) && url.port.length > 0) {
        options.port = Number(url.port);
    }
    if (url.username || url.password) {
        options.auth = `${url.username || ''}:${url.password || ''}`;
    }
    return options;
};


/***/ }),

/***/ 30:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOctokitOptions = exports.GitHub = exports.context = void 0;
const Context = __importStar(__webpack_require__(53));
const Utils = __importStar(__webpack_require__(914));
// octokit + plugins
const core_1 = __webpack_require__(762);
const plugin_rest_endpoint_methods_1 = __webpack_require__(44);
const plugin_paginate_rest_1 = __webpack_require__(193);
exports.context = new Context.Context();
const baseUrl = Utils.getApiBaseUrl();
const defaults = {
    baseUrl,
    request: {
        agent: Utils.getProxyAgent(baseUrl)
    }
};
exports.GitHub = core_1.Octokit.plugin(plugin_rest_endpoint_methods_1.restEndpointMethods, plugin_paginate_rest_1.paginateRest).defaults(defaults);
/**
 * Convience function to correctly format Octokit Options to pass into the constructor.
 *
 * @param     token    the repo PAT or GITHUB_TOKEN
 * @param     options  other options to set
 */
function getOctokitOptions(token, options) {
    const opts = Object.assign({}, options || {}); // Shallow clone - don't mutate the object provided by the caller
    // Auth
    const auth = Utils.getAuthString(token, opts);
    if (auth) {
        opts.auth = auth;
    }
    return opts;
}
exports.getOctokitOptions = getOctokitOptions;
//# sourceMappingURL=utils.js.map

/***/ }),

/***/ 40:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const {constants: BufferConstants} = __webpack_require__(293);
const pump = __webpack_require__(341);
const bufferStream = __webpack_require__(340);

class MaxBufferError extends Error {
	constructor() {
		super('maxBuffer exceeded');
		this.name = 'MaxBufferError';
	}
}

async function getStream(inputStream, options) {
	if (!inputStream) {
		return Promise.reject(new Error('Expected a stream'));
	}

	options = {
		maxBuffer: Infinity,
		...options
	};

	const {maxBuffer} = options;

	let stream;
	await new Promise((resolve, reject) => {
		const rejectPromise = error => {
			// Don't retrieve an oversized buffer.
			if (error && stream.getBufferedLength() <= BufferConstants.MAX_LENGTH) {
				error.bufferedData = stream.getBufferedValue();
			}

			reject(error);
		};

		stream = pump(inputStream, bufferStream(options), error => {
			if (error) {
				rejectPromise(error);
				return;
			}

			resolve();
		});

		stream.on('data', () => {
			if (stream.getBufferedLength() > maxBuffer) {
				rejectPromise(new MaxBufferError());
			}
		});
	});

	return stream.getBufferedValue();
}

module.exports = getStream;
// TODO: Remove this for the next major release
module.exports.default = getStream;
module.exports.buffer = (stream, options) => getStream(stream, {...options, encoding: 'buffer'});
module.exports.array = (stream, options) => getStream(stream, {...options, array: true});
module.exports.MaxBufferError = MaxBufferError;


/***/ }),

/***/ 44:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

const Endpoints = {
  actions: {
    addSelectedRepoToOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}"],
    cancelWorkflowRun: ["POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel"],
    createOrUpdateOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}"],
    createOrUpdateRepoSecret: ["PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    createRegistrationTokenForOrg: ["POST /orgs/{org}/actions/runners/registration-token"],
    createRegistrationTokenForRepo: ["POST /repos/{owner}/{repo}/actions/runners/registration-token"],
    createRemoveTokenForOrg: ["POST /orgs/{org}/actions/runners/remove-token"],
    createRemoveTokenForRepo: ["POST /repos/{owner}/{repo}/actions/runners/remove-token"],
    createWorkflowDispatch: ["POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"],
    deleteArtifact: ["DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}"],
    deleteOrgSecret: ["DELETE /orgs/{org}/actions/secrets/{secret_name}"],
    deleteRepoSecret: ["DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    deleteSelfHostedRunnerFromOrg: ["DELETE /orgs/{org}/actions/runners/{runner_id}"],
    deleteSelfHostedRunnerFromRepo: ["DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}"],
    deleteWorkflowRun: ["DELETE /repos/{owner}/{repo}/actions/runs/{run_id}"],
    deleteWorkflowRunLogs: ["DELETE /repos/{owner}/{repo}/actions/runs/{run_id}/logs"],
    downloadArtifact: ["GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}"],
    downloadJobLogsForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs"],
    downloadWorkflowRunLogs: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs"],
    getArtifact: ["GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}"],
    getJobForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/jobs/{job_id}"],
    getOrgPublicKey: ["GET /orgs/{org}/actions/secrets/public-key"],
    getOrgSecret: ["GET /orgs/{org}/actions/secrets/{secret_name}"],
    getRepoPublicKey: ["GET /repos/{owner}/{repo}/actions/secrets/public-key"],
    getRepoSecret: ["GET /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    getSelfHostedRunnerForOrg: ["GET /orgs/{org}/actions/runners/{runner_id}"],
    getSelfHostedRunnerForRepo: ["GET /repos/{owner}/{repo}/actions/runners/{runner_id}"],
    getWorkflow: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}"],
    getWorkflowRun: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}"],
    getWorkflowRunUsage: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing"],
    getWorkflowUsage: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/timing"],
    listArtifactsForRepo: ["GET /repos/{owner}/{repo}/actions/artifacts"],
    listJobsForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"],
    listOrgSecrets: ["GET /orgs/{org}/actions/secrets"],
    listRepoSecrets: ["GET /repos/{owner}/{repo}/actions/secrets"],
    listRepoWorkflows: ["GET /repos/{owner}/{repo}/actions/workflows"],
    listRunnerApplicationsForOrg: ["GET /orgs/{org}/actions/runners/downloads"],
    listRunnerApplicationsForRepo: ["GET /repos/{owner}/{repo}/actions/runners/downloads"],
    listSelectedReposForOrgSecret: ["GET /orgs/{org}/actions/secrets/{secret_name}/repositories"],
    listSelfHostedRunnersForOrg: ["GET /orgs/{org}/actions/runners"],
    listSelfHostedRunnersForRepo: ["GET /repos/{owner}/{repo}/actions/runners"],
    listWorkflowRunArtifacts: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts"],
    listWorkflowRuns: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"],
    listWorkflowRunsForRepo: ["GET /repos/{owner}/{repo}/actions/runs"],
    reRunWorkflow: ["POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun"],
    removeSelectedRepoFromOrgSecret: ["DELETE /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}"],
    setSelectedReposForOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}/repositories"]
  },
  activity: {
    checkRepoIsStarredByAuthenticatedUser: ["GET /user/starred/{owner}/{repo}"],
    deleteRepoSubscription: ["DELETE /repos/{owner}/{repo}/subscription"],
    deleteThreadSubscription: ["DELETE /notifications/threads/{thread_id}/subscription"],
    getFeeds: ["GET /feeds"],
    getRepoSubscription: ["GET /repos/{owner}/{repo}/subscription"],
    getThread: ["GET /notifications/threads/{thread_id}"],
    getThreadSubscriptionForAuthenticatedUser: ["GET /notifications/threads/{thread_id}/subscription"],
    listEventsForAuthenticatedUser: ["GET /users/{username}/events"],
    listNotificationsForAuthenticatedUser: ["GET /notifications"],
    listOrgEventsForAuthenticatedUser: ["GET /users/{username}/events/orgs/{org}"],
    listPublicEvents: ["GET /events"],
    listPublicEventsForRepoNetwork: ["GET /networks/{owner}/{repo}/events"],
    listPublicEventsForUser: ["GET /users/{username}/events/public"],
    listPublicOrgEvents: ["GET /orgs/{org}/events"],
    listReceivedEventsForUser: ["GET /users/{username}/received_events"],
    listReceivedPublicEventsForUser: ["GET /users/{username}/received_events/public"],
    listRepoEvents: ["GET /repos/{owner}/{repo}/events"],
    listRepoNotificationsForAuthenticatedUser: ["GET /repos/{owner}/{repo}/notifications"],
    listReposStarredByAuthenticatedUser: ["GET /user/starred"],
    listReposStarredByUser: ["GET /users/{username}/starred"],
    listReposWatchedByUser: ["GET /users/{username}/subscriptions"],
    listStargazersForRepo: ["GET /repos/{owner}/{repo}/stargazers"],
    listWatchedReposForAuthenticatedUser: ["GET /user/subscriptions"],
    listWatchersForRepo: ["GET /repos/{owner}/{repo}/subscribers"],
    markNotificationsAsRead: ["PUT /notifications"],
    markRepoNotificationsAsRead: ["PUT /repos/{owner}/{repo}/notifications"],
    markThreadAsRead: ["PATCH /notifications/threads/{thread_id}"],
    setRepoSubscription: ["PUT /repos/{owner}/{repo}/subscription"],
    setThreadSubscription: ["PUT /notifications/threads/{thread_id}/subscription"],
    starRepoForAuthenticatedUser: ["PUT /user/starred/{owner}/{repo}"],
    unstarRepoForAuthenticatedUser: ["DELETE /user/starred/{owner}/{repo}"]
  },
  apps: {
    addRepoToInstallation: ["PUT /user/installations/{installation_id}/repositories/{repository_id}"],
    checkToken: ["POST /applications/{client_id}/token"],
    createContentAttachment: ["POST /content_references/{content_reference_id}/attachments", {
      mediaType: {
        previews: ["corsair"]
      }
    }],
    createFromManifest: ["POST /app-manifests/{code}/conversions"],
    createInstallationAccessToken: ["POST /app/installations/{installation_id}/access_tokens"],
    deleteAuthorization: ["DELETE /applications/{client_id}/grant"],
    deleteInstallation: ["DELETE /app/installations/{installation_id}"],
    deleteToken: ["DELETE /applications/{client_id}/token"],
    getAuthenticated: ["GET /app"],
    getBySlug: ["GET /apps/{app_slug}"],
    getInstallation: ["GET /app/installations/{installation_id}"],
    getOrgInstallation: ["GET /orgs/{org}/installation"],
    getRepoInstallation: ["GET /repos/{owner}/{repo}/installation"],
    getSubscriptionPlanForAccount: ["GET /marketplace_listing/accounts/{account_id}"],
    getSubscriptionPlanForAccountStubbed: ["GET /marketplace_listing/stubbed/accounts/{account_id}"],
    getUserInstallation: ["GET /users/{username}/installation"],
    listAccountsForPlan: ["GET /marketplace_listing/plans/{plan_id}/accounts"],
    listAccountsForPlanStubbed: ["GET /marketplace_listing/stubbed/plans/{plan_id}/accounts"],
    listInstallationReposForAuthenticatedUser: ["GET /user/installations/{installation_id}/repositories"],
    listInstallations: ["GET /app/installations"],
    listInstallationsForAuthenticatedUser: ["GET /user/installations"],
    listPlans: ["GET /marketplace_listing/plans"],
    listPlansStubbed: ["GET /marketplace_listing/stubbed/plans"],
    listReposAccessibleToInstallation: ["GET /installation/repositories"],
    listSubscriptionsForAuthenticatedUser: ["GET /user/marketplace_purchases"],
    listSubscriptionsForAuthenticatedUserStubbed: ["GET /user/marketplace_purchases/stubbed"],
    removeRepoFromInstallation: ["DELETE /user/installations/{installation_id}/repositories/{repository_id}"],
    resetToken: ["PATCH /applications/{client_id}/token"],
    revokeInstallationAccessToken: ["DELETE /installation/token"],
    suspendInstallation: ["PUT /app/installations/{installation_id}/suspended"],
    unsuspendInstallation: ["DELETE /app/installations/{installation_id}/suspended"]
  },
  billing: {
    getGithubActionsBillingOrg: ["GET /orgs/{org}/settings/billing/actions"],
    getGithubActionsBillingUser: ["GET /users/{username}/settings/billing/actions"],
    getGithubPackagesBillingOrg: ["GET /orgs/{org}/settings/billing/packages"],
    getGithubPackagesBillingUser: ["GET /users/{username}/settings/billing/packages"],
    getSharedStorageBillingOrg: ["GET /orgs/{org}/settings/billing/shared-storage"],
    getSharedStorageBillingUser: ["GET /users/{username}/settings/billing/shared-storage"]
  },
  checks: {
    create: ["POST /repos/{owner}/{repo}/check-runs", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    createSuite: ["POST /repos/{owner}/{repo}/check-suites", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    get: ["GET /repos/{owner}/{repo}/check-runs/{check_run_id}", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    getSuite: ["GET /repos/{owner}/{repo}/check-suites/{check_suite_id}", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listAnnotations: ["GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listForSuite: ["GET /repos/{owner}/{repo}/check-suites/{check_suite_id}/check-runs", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listSuitesForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/check-suites", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    rerequestSuite: ["POST /repos/{owner}/{repo}/check-suites/{check_suite_id}/rerequest", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    setSuitesPreferences: ["PATCH /repos/{owner}/{repo}/check-suites/preferences", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    update: ["PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
      mediaType: {
        previews: ["antiope"]
      }
    }]
  },
  codeScanning: {
    getAlert: ["GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}", {}, {
      renamedParameters: {
        alert_id: "alert_number"
      }
    }],
    listAlertsForRepo: ["GET /repos/{owner}/{repo}/code-scanning/alerts"],
    listRecentAnalyses: ["GET /repos/{owner}/{repo}/code-scanning/analyses"],
    updateAlert: ["PATCH /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}"],
    uploadSarif: ["POST /repos/{owner}/{repo}/code-scanning/sarifs"]
  },
  codesOfConduct: {
    getAllCodesOfConduct: ["GET /codes_of_conduct", {
      mediaType: {
        previews: ["scarlet-witch"]
      }
    }],
    getConductCode: ["GET /codes_of_conduct/{key}", {
      mediaType: {
        previews: ["scarlet-witch"]
      }
    }],
    getForRepo: ["GET /repos/{owner}/{repo}/community/code_of_conduct", {
      mediaType: {
        previews: ["scarlet-witch"]
      }
    }]
  },
  emojis: {
    get: ["GET /emojis"]
  },
  gists: {
    checkIsStarred: ["GET /gists/{gist_id}/star"],
    create: ["POST /gists"],
    createComment: ["POST /gists/{gist_id}/comments"],
    delete: ["DELETE /gists/{gist_id}"],
    deleteComment: ["DELETE /gists/{gist_id}/comments/{comment_id}"],
    fork: ["POST /gists/{gist_id}/forks"],
    get: ["GET /gists/{gist_id}"],
    getComment: ["GET /gists/{gist_id}/comments/{comment_id}"],
    getRevision: ["GET /gists/{gist_id}/{sha}"],
    list: ["GET /gists"],
    listComments: ["GET /gists/{gist_id}/comments"],
    listCommits: ["GET /gists/{gist_id}/commits"],
    listForUser: ["GET /users/{username}/gists"],
    listForks: ["GET /gists/{gist_id}/forks"],
    listPublic: ["GET /gists/public"],
    listStarred: ["GET /gists/starred"],
    star: ["PUT /gists/{gist_id}/star"],
    unstar: ["DELETE /gists/{gist_id}/star"],
    update: ["PATCH /gists/{gist_id}"],
    updateComment: ["PATCH /gists/{gist_id}/comments/{comment_id}"]
  },
  git: {
    createBlob: ["POST /repos/{owner}/{repo}/git/blobs"],
    createCommit: ["POST /repos/{owner}/{repo}/git/commits"],
    createRef: ["POST /repos/{owner}/{repo}/git/refs"],
    createTag: ["POST /repos/{owner}/{repo}/git/tags"],
    createTree: ["POST /repos/{owner}/{repo}/git/trees"],
    deleteRef: ["DELETE /repos/{owner}/{repo}/git/refs/{ref}"],
    getBlob: ["GET /repos/{owner}/{repo}/git/blobs/{file_sha}"],
    getCommit: ["GET /repos/{owner}/{repo}/git/commits/{commit_sha}"],
    getRef: ["GET /repos/{owner}/{repo}/git/ref/{ref}"],
    getTag: ["GET /repos/{owner}/{repo}/git/tags/{tag_sha}"],
    getTree: ["GET /repos/{owner}/{repo}/git/trees/{tree_sha}"],
    listMatchingRefs: ["GET /repos/{owner}/{repo}/git/matching-refs/{ref}"],
    updateRef: ["PATCH /repos/{owner}/{repo}/git/refs/{ref}"]
  },
  gitignore: {
    getAllTemplates: ["GET /gitignore/templates"],
    getTemplate: ["GET /gitignore/templates/{name}"]
  },
  interactions: {
    getRestrictionsForOrg: ["GET /orgs/{org}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    getRestrictionsForRepo: ["GET /repos/{owner}/{repo}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    removeRestrictionsForOrg: ["DELETE /orgs/{org}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    removeRestrictionsForRepo: ["DELETE /repos/{owner}/{repo}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    setRestrictionsForOrg: ["PUT /orgs/{org}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    setRestrictionsForRepo: ["PUT /repos/{owner}/{repo}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }]
  },
  issues: {
    addAssignees: ["POST /repos/{owner}/{repo}/issues/{issue_number}/assignees"],
    addLabels: ["POST /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    checkUserCanBeAssigned: ["GET /repos/{owner}/{repo}/assignees/{assignee}"],
    create: ["POST /repos/{owner}/{repo}/issues"],
    createComment: ["POST /repos/{owner}/{repo}/issues/{issue_number}/comments"],
    createLabel: ["POST /repos/{owner}/{repo}/labels"],
    createMilestone: ["POST /repos/{owner}/{repo}/milestones"],
    deleteComment: ["DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    deleteLabel: ["DELETE /repos/{owner}/{repo}/labels/{name}"],
    deleteMilestone: ["DELETE /repos/{owner}/{repo}/milestones/{milestone_number}"],
    get: ["GET /repos/{owner}/{repo}/issues/{issue_number}"],
    getComment: ["GET /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    getEvent: ["GET /repos/{owner}/{repo}/issues/events/{event_id}"],
    getLabel: ["GET /repos/{owner}/{repo}/labels/{name}"],
    getMilestone: ["GET /repos/{owner}/{repo}/milestones/{milestone_number}"],
    list: ["GET /issues"],
    listAssignees: ["GET /repos/{owner}/{repo}/assignees"],
    listComments: ["GET /repos/{owner}/{repo}/issues/{issue_number}/comments"],
    listCommentsForRepo: ["GET /repos/{owner}/{repo}/issues/comments"],
    listEvents: ["GET /repos/{owner}/{repo}/issues/{issue_number}/events"],
    listEventsForRepo: ["GET /repos/{owner}/{repo}/issues/events"],
    listEventsForTimeline: ["GET /repos/{owner}/{repo}/issues/{issue_number}/timeline", {
      mediaType: {
        previews: ["mockingbird"]
      }
    }],
    listForAuthenticatedUser: ["GET /user/issues"],
    listForOrg: ["GET /orgs/{org}/issues"],
    listForRepo: ["GET /repos/{owner}/{repo}/issues"],
    listLabelsForMilestone: ["GET /repos/{owner}/{repo}/milestones/{milestone_number}/labels"],
    listLabelsForRepo: ["GET /repos/{owner}/{repo}/labels"],
    listLabelsOnIssue: ["GET /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    listMilestones: ["GET /repos/{owner}/{repo}/milestones"],
    lock: ["PUT /repos/{owner}/{repo}/issues/{issue_number}/lock"],
    removeAllLabels: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    removeAssignees: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees"],
    removeLabel: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}"],
    setLabels: ["PUT /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    unlock: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock"],
    update: ["PATCH /repos/{owner}/{repo}/issues/{issue_number}"],
    updateComment: ["PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    updateLabel: ["PATCH /repos/{owner}/{repo}/labels/{name}"],
    updateMilestone: ["PATCH /repos/{owner}/{repo}/milestones/{milestone_number}"]
  },
  licenses: {
    get: ["GET /licenses/{license}"],
    getAllCommonlyUsed: ["GET /licenses"],
    getForRepo: ["GET /repos/{owner}/{repo}/license"]
  },
  markdown: {
    render: ["POST /markdown"],
    renderRaw: ["POST /markdown/raw", {
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    }]
  },
  meta: {
    get: ["GET /meta"]
  },
  migrations: {
    cancelImport: ["DELETE /repos/{owner}/{repo}/import"],
    deleteArchiveForAuthenticatedUser: ["DELETE /user/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    deleteArchiveForOrg: ["DELETE /orgs/{org}/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    downloadArchiveForOrg: ["GET /orgs/{org}/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    getArchiveForAuthenticatedUser: ["GET /user/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    getCommitAuthors: ["GET /repos/{owner}/{repo}/import/authors"],
    getImportStatus: ["GET /repos/{owner}/{repo}/import"],
    getLargeFiles: ["GET /repos/{owner}/{repo}/import/large_files"],
    getStatusForAuthenticatedUser: ["GET /user/migrations/{migration_id}", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    getStatusForOrg: ["GET /orgs/{org}/migrations/{migration_id}", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listForAuthenticatedUser: ["GET /user/migrations", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listForOrg: ["GET /orgs/{org}/migrations", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listReposForOrg: ["GET /orgs/{org}/migrations/{migration_id}/repositories", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listReposForUser: ["GET /user/migrations/{migration_id}/repositories", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    mapCommitAuthor: ["PATCH /repos/{owner}/{repo}/import/authors/{author_id}"],
    setLfsPreference: ["PATCH /repos/{owner}/{repo}/import/lfs"],
    startForAuthenticatedUser: ["POST /user/migrations"],
    startForOrg: ["POST /orgs/{org}/migrations"],
    startImport: ["PUT /repos/{owner}/{repo}/import"],
    unlockRepoForAuthenticatedUser: ["DELETE /user/migrations/{migration_id}/repos/{repo_name}/lock", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    unlockRepoForOrg: ["DELETE /orgs/{org}/migrations/{migration_id}/repos/{repo_name}/lock", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    updateImport: ["PATCH /repos/{owner}/{repo}/import"]
  },
  orgs: {
    blockUser: ["PUT /orgs/{org}/blocks/{username}"],
    checkBlockedUser: ["GET /orgs/{org}/blocks/{username}"],
    checkMembershipForUser: ["GET /orgs/{org}/members/{username}"],
    checkPublicMembershipForUser: ["GET /orgs/{org}/public_members/{username}"],
    convertMemberToOutsideCollaborator: ["PUT /orgs/{org}/outside_collaborators/{username}"],
    createInvitation: ["POST /orgs/{org}/invitations"],
    createWebhook: ["POST /orgs/{org}/hooks"],
    deleteWebhook: ["DELETE /orgs/{org}/hooks/{hook_id}"],
    get: ["GET /orgs/{org}"],
    getMembershipForAuthenticatedUser: ["GET /user/memberships/orgs/{org}"],
    getMembershipForUser: ["GET /orgs/{org}/memberships/{username}"],
    getWebhook: ["GET /orgs/{org}/hooks/{hook_id}"],
    list: ["GET /organizations"],
    listAppInstallations: ["GET /orgs/{org}/installations"],
    listBlockedUsers: ["GET /orgs/{org}/blocks"],
    listForAuthenticatedUser: ["GET /user/orgs"],
    listForUser: ["GET /users/{username}/orgs"],
    listInvitationTeams: ["GET /orgs/{org}/invitations/{invitation_id}/teams"],
    listMembers: ["GET /orgs/{org}/members"],
    listMembershipsForAuthenticatedUser: ["GET /user/memberships/orgs"],
    listOutsideCollaborators: ["GET /orgs/{org}/outside_collaborators"],
    listPendingInvitations: ["GET /orgs/{org}/invitations"],
    listPublicMembers: ["GET /orgs/{org}/public_members"],
    listWebhooks: ["GET /orgs/{org}/hooks"],
    pingWebhook: ["POST /orgs/{org}/hooks/{hook_id}/pings"],
    removeMember: ["DELETE /orgs/{org}/members/{username}"],
    removeMembershipForUser: ["DELETE /orgs/{org}/memberships/{username}"],
    removeOutsideCollaborator: ["DELETE /orgs/{org}/outside_collaborators/{username}"],
    removePublicMembershipForAuthenticatedUser: ["DELETE /orgs/{org}/public_members/{username}"],
    setMembershipForUser: ["PUT /orgs/{org}/memberships/{username}"],
    setPublicMembershipForAuthenticatedUser: ["PUT /orgs/{org}/public_members/{username}"],
    unblockUser: ["DELETE /orgs/{org}/blocks/{username}"],
    update: ["PATCH /orgs/{org}"],
    updateMembershipForAuthenticatedUser: ["PATCH /user/memberships/orgs/{org}"],
    updateWebhook: ["PATCH /orgs/{org}/hooks/{hook_id}"]
  },
  projects: {
    addCollaborator: ["PUT /projects/{project_id}/collaborators/{username}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createCard: ["POST /projects/columns/{column_id}/cards", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createColumn: ["POST /projects/{project_id}/columns", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createForAuthenticatedUser: ["POST /user/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createForOrg: ["POST /orgs/{org}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createForRepo: ["POST /repos/{owner}/{repo}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    delete: ["DELETE /projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    deleteCard: ["DELETE /projects/columns/cards/{card_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    deleteColumn: ["DELETE /projects/columns/{column_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    get: ["GET /projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    getCard: ["GET /projects/columns/cards/{card_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    getColumn: ["GET /projects/columns/{column_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    getPermissionForUser: ["GET /projects/{project_id}/collaborators/{username}/permission", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listCards: ["GET /projects/columns/{column_id}/cards", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listCollaborators: ["GET /projects/{project_id}/collaborators", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listColumns: ["GET /projects/{project_id}/columns", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listForOrg: ["GET /orgs/{org}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listForRepo: ["GET /repos/{owner}/{repo}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listForUser: ["GET /users/{username}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    moveCard: ["POST /projects/columns/cards/{card_id}/moves", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    moveColumn: ["POST /projects/columns/{column_id}/moves", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    removeCollaborator: ["DELETE /projects/{project_id}/collaborators/{username}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    update: ["PATCH /projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    updateCard: ["PATCH /projects/columns/cards/{card_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    updateColumn: ["PATCH /projects/columns/{column_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }]
  },
  pulls: {
    checkIfMerged: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/merge"],
    create: ["POST /repos/{owner}/{repo}/pulls"],
    createReplyForReviewComment: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies"],
    createReview: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews"],
    createReviewComment: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/comments"],
    deletePendingReview: ["DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"],
    deleteReviewComment: ["DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}"],
    dismissReview: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals"],
    get: ["GET /repos/{owner}/{repo}/pulls/{pull_number}"],
    getReview: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"],
    getReviewComment: ["GET /repos/{owner}/{repo}/pulls/comments/{comment_id}"],
    list: ["GET /repos/{owner}/{repo}/pulls"],
    listCommentsForReview: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments"],
    listCommits: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"],
    listFiles: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/files"],
    listRequestedReviewers: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"],
    listReviewComments: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/comments"],
    listReviewCommentsForRepo: ["GET /repos/{owner}/{repo}/pulls/comments"],
    listReviews: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"],
    merge: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge"],
    removeRequestedReviewers: ["DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"],
    requestReviewers: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"],
    submitReview: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events"],
    update: ["PATCH /repos/{owner}/{repo}/pulls/{pull_number}"],
    updateBranch: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch", {
      mediaType: {
        previews: ["lydian"]
      }
    }],
    updateReview: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"],
    updateReviewComment: ["PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}"]
  },
  rateLimit: {
    get: ["GET /rate_limit"]
  },
  reactions: {
    createForCommitComment: ["POST /repos/{owner}/{repo}/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForIssue: ["POST /repos/{owner}/{repo}/issues/{issue_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForIssueComment: ["POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForPullRequestReviewComment: ["POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForTeamDiscussionCommentInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForTeamDiscussionInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForCommitComment: ["DELETE /repos/{owner}/{repo}/comments/{comment_id}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForIssue: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForIssueComment: ["DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForPullRequestComment: ["DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForTeamDiscussion: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForTeamDiscussionComment: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteLegacy: ["DELETE /reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }, {
      deprecated: "octokit.reactions.deleteLegacy() is deprecated, see https://developer.github.com/v3/reactions/#delete-a-reaction-legacy"
    }],
    listForCommitComment: ["GET /repos/{owner}/{repo}/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForIssue: ["GET /repos/{owner}/{repo}/issues/{issue_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForIssueComment: ["GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForPullRequestReviewComment: ["GET /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForTeamDiscussionCommentInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForTeamDiscussionInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }]
  },
  repos: {
    acceptInvitation: ["PATCH /user/repository_invitations/{invitation_id}"],
    addAppAccessRestrictions: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps", {}, {
      mapToData: "apps"
    }],
    addCollaborator: ["PUT /repos/{owner}/{repo}/collaborators/{username}"],
    addStatusCheckContexts: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts", {}, {
      mapToData: "contexts"
    }],
    addTeamAccessRestrictions: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams", {}, {
      mapToData: "teams"
    }],
    addUserAccessRestrictions: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users", {}, {
      mapToData: "users"
    }],
    checkCollaborator: ["GET /repos/{owner}/{repo}/collaborators/{username}"],
    checkVulnerabilityAlerts: ["GET /repos/{owner}/{repo}/vulnerability-alerts", {
      mediaType: {
        previews: ["dorian"]
      }
    }],
    compareCommits: ["GET /repos/{owner}/{repo}/compare/{base}...{head}"],
    createCommitComment: ["POST /repos/{owner}/{repo}/commits/{commit_sha}/comments"],
    createCommitSignatureProtection: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures", {
      mediaType: {
        previews: ["zzzax"]
      }
    }],
    createCommitStatus: ["POST /repos/{owner}/{repo}/statuses/{sha}"],
    createDeployKey: ["POST /repos/{owner}/{repo}/keys"],
    createDeployment: ["POST /repos/{owner}/{repo}/deployments"],
    createDeploymentStatus: ["POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"],
    createDispatchEvent: ["POST /repos/{owner}/{repo}/dispatches"],
    createForAuthenticatedUser: ["POST /user/repos"],
    createFork: ["POST /repos/{owner}/{repo}/forks"],
    createInOrg: ["POST /orgs/{org}/repos"],
    createOrUpdateFileContents: ["PUT /repos/{owner}/{repo}/contents/{path}"],
    createPagesSite: ["POST /repos/{owner}/{repo}/pages", {
      mediaType: {
        previews: ["switcheroo"]
      }
    }],
    createRelease: ["POST /repos/{owner}/{repo}/releases"],
    createUsingTemplate: ["POST /repos/{template_owner}/{template_repo}/generate", {
      mediaType: {
        previews: ["baptiste"]
      }
    }],
    createWebhook: ["POST /repos/{owner}/{repo}/hooks"],
    declineInvitation: ["DELETE /user/repository_invitations/{invitation_id}"],
    delete: ["DELETE /repos/{owner}/{repo}"],
    deleteAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions"],
    deleteAdminBranchProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"],
    deleteBranchProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection"],
    deleteCommitComment: ["DELETE /repos/{owner}/{repo}/comments/{comment_id}"],
    deleteCommitSignatureProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures", {
      mediaType: {
        previews: ["zzzax"]
      }
    }],
    deleteDeployKey: ["DELETE /repos/{owner}/{repo}/keys/{key_id}"],
    deleteDeployment: ["DELETE /repos/{owner}/{repo}/deployments/{deployment_id}"],
    deleteFile: ["DELETE /repos/{owner}/{repo}/contents/{path}"],
    deleteInvitation: ["DELETE /repos/{owner}/{repo}/invitations/{invitation_id}"],
    deletePagesSite: ["DELETE /repos/{owner}/{repo}/pages", {
      mediaType: {
        previews: ["switcheroo"]
      }
    }],
    deletePullRequestReviewProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"],
    deleteRelease: ["DELETE /repos/{owner}/{repo}/releases/{release_id}"],
    deleteReleaseAsset: ["DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    deleteWebhook: ["DELETE /repos/{owner}/{repo}/hooks/{hook_id}"],
    disableAutomatedSecurityFixes: ["DELETE /repos/{owner}/{repo}/automated-security-fixes", {
      mediaType: {
        previews: ["london"]
      }
    }],
    disableVulnerabilityAlerts: ["DELETE /repos/{owner}/{repo}/vulnerability-alerts", {
      mediaType: {
        previews: ["dorian"]
      }
    }],
    downloadArchive: ["GET /repos/{owner}/{repo}/{archive_format}/{ref}"],
    enableAutomatedSecurityFixes: ["PUT /repos/{owner}/{repo}/automated-security-fixes", {
      mediaType: {
        previews: ["london"]
      }
    }],
    enableVulnerabilityAlerts: ["PUT /repos/{owner}/{repo}/vulnerability-alerts", {
      mediaType: {
        previews: ["dorian"]
      }
    }],
    get: ["GET /repos/{owner}/{repo}"],
    getAccessRestrictions: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions"],
    getAdminBranchProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"],
    getAllStatusCheckContexts: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts"],
    getAllTopics: ["GET /repos/{owner}/{repo}/topics", {
      mediaType: {
        previews: ["mercy"]
      }
    }],
    getAppsWithAccessToProtectedBranch: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps"],
    getBranch: ["GET /repos/{owner}/{repo}/branches/{branch}"],
    getBranchProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection"],
    getClones: ["GET /repos/{owner}/{repo}/traffic/clones"],
    getCodeFrequencyStats: ["GET /repos/{owner}/{repo}/stats/code_frequency"],
    getCollaboratorPermissionLevel: ["GET /repos/{owner}/{repo}/collaborators/{username}/permission"],
    getCombinedStatusForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/status"],
    getCommit: ["GET /repos/{owner}/{repo}/commits/{ref}"],
    getCommitActivityStats: ["GET /repos/{owner}/{repo}/stats/commit_activity"],
    getCommitComment: ["GET /repos/{owner}/{repo}/comments/{comment_id}"],
    getCommitSignatureProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures", {
      mediaType: {
        previews: ["zzzax"]
      }
    }],
    getCommunityProfileMetrics: ["GET /repos/{owner}/{repo}/community/profile", {
      mediaType: {
        previews: ["black-panther"]
      }
    }],
    getContent: ["GET /repos/{owner}/{repo}/contents/{path}"],
    getContributorsStats: ["GET /repos/{owner}/{repo}/stats/contributors"],
    getDeployKey: ["GET /repos/{owner}/{repo}/keys/{key_id}"],
    getDeployment: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}"],
    getDeploymentStatus: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses/{status_id}"],
    getLatestPagesBuild: ["GET /repos/{owner}/{repo}/pages/builds/latest"],
    getLatestRelease: ["GET /repos/{owner}/{repo}/releases/latest"],
    getPages: ["GET /repos/{owner}/{repo}/pages"],
    getPagesBuild: ["GET /repos/{owner}/{repo}/pages/builds/{build_id}"],
    getParticipationStats: ["GET /repos/{owner}/{repo}/stats/participation"],
    getPullRequestReviewProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"],
    getPunchCardStats: ["GET /repos/{owner}/{repo}/stats/punch_card"],
    getReadme: ["GET /repos/{owner}/{repo}/readme"],
    getRelease: ["GET /repos/{owner}/{repo}/releases/{release_id}"],
    getReleaseAsset: ["GET /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    getReleaseByTag: ["GET /repos/{owner}/{repo}/releases/tags/{tag}"],
    getStatusChecksProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"],
    getTeamsWithAccessToProtectedBranch: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams"],
    getTopPaths: ["GET /repos/{owner}/{repo}/traffic/popular/paths"],
    getTopReferrers: ["GET /repos/{owner}/{repo}/traffic/popular/referrers"],
    getUsersWithAccessToProtectedBranch: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users"],
    getViews: ["GET /repos/{owner}/{repo}/traffic/views"],
    getWebhook: ["GET /repos/{owner}/{repo}/hooks/{hook_id}"],
    listBranches: ["GET /repos/{owner}/{repo}/branches"],
    listBranchesForHeadCommit: ["GET /repos/{owner}/{repo}/commits/{commit_sha}/branches-where-head", {
      mediaType: {
        previews: ["groot"]
      }
    }],
    listCollaborators: ["GET /repos/{owner}/{repo}/collaborators"],
    listCommentsForCommit: ["GET /repos/{owner}/{repo}/commits/{commit_sha}/comments"],
    listCommitCommentsForRepo: ["GET /repos/{owner}/{repo}/comments"],
    listCommitStatusesForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/statuses"],
    listCommits: ["GET /repos/{owner}/{repo}/commits"],
    listContributors: ["GET /repos/{owner}/{repo}/contributors"],
    listDeployKeys: ["GET /repos/{owner}/{repo}/keys"],
    listDeploymentStatuses: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"],
    listDeployments: ["GET /repos/{owner}/{repo}/deployments"],
    listForAuthenticatedUser: ["GET /user/repos"],
    listForOrg: ["GET /orgs/{org}/repos"],
    listForUser: ["GET /users/{username}/repos"],
    listForks: ["GET /repos/{owner}/{repo}/forks"],
    listInvitations: ["GET /repos/{owner}/{repo}/invitations"],
    listInvitationsForAuthenticatedUser: ["GET /user/repository_invitations"],
    listLanguages: ["GET /repos/{owner}/{repo}/languages"],
    listPagesBuilds: ["GET /repos/{owner}/{repo}/pages/builds"],
    listPublic: ["GET /repositories"],
    listPullRequestsAssociatedWithCommit: ["GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls", {
      mediaType: {
        previews: ["groot"]
      }
    }],
    listReleaseAssets: ["GET /repos/{owner}/{repo}/releases/{release_id}/assets"],
    listReleases: ["GET /repos/{owner}/{repo}/releases"],
    listTags: ["GET /repos/{owner}/{repo}/tags"],
    listTeams: ["GET /repos/{owner}/{repo}/teams"],
    listWebhooks: ["GET /repos/{owner}/{repo}/hooks"],
    merge: ["POST /repos/{owner}/{repo}/merges"],
    pingWebhook: ["POST /repos/{owner}/{repo}/hooks/{hook_id}/pings"],
    removeAppAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps", {}, {
      mapToData: "apps"
    }],
    removeCollaborator: ["DELETE /repos/{owner}/{repo}/collaborators/{username}"],
    removeStatusCheckContexts: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts", {}, {
      mapToData: "contexts"
    }],
    removeStatusCheckProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"],
    removeTeamAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams", {}, {
      mapToData: "teams"
    }],
    removeUserAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users", {}, {
      mapToData: "users"
    }],
    replaceAllTopics: ["PUT /repos/{owner}/{repo}/topics", {
      mediaType: {
        previews: ["mercy"]
      }
    }],
    requestPagesBuild: ["POST /repos/{owner}/{repo}/pages/builds"],
    setAdminBranchProtection: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"],
    setAppAccessRestrictions: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps", {}, {
      mapToData: "apps"
    }],
    setStatusCheckContexts: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts", {}, {
      mapToData: "contexts"
    }],
    setTeamAccessRestrictions: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams", {}, {
      mapToData: "teams"
    }],
    setUserAccessRestrictions: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users", {}, {
      mapToData: "users"
    }],
    testPushWebhook: ["POST /repos/{owner}/{repo}/hooks/{hook_id}/tests"],
    transfer: ["POST /repos/{owner}/{repo}/transfer"],
    update: ["PATCH /repos/{owner}/{repo}"],
    updateBranchProtection: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection"],
    updateCommitComment: ["PATCH /repos/{owner}/{repo}/comments/{comment_id}"],
    updateInformationAboutPagesSite: ["PUT /repos/{owner}/{repo}/pages"],
    updateInvitation: ["PATCH /repos/{owner}/{repo}/invitations/{invitation_id}"],
    updatePullRequestReviewProtection: ["PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"],
    updateRelease: ["PATCH /repos/{owner}/{repo}/releases/{release_id}"],
    updateReleaseAsset: ["PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    updateStatusCheckPotection: ["PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"],
    updateWebhook: ["PATCH /repos/{owner}/{repo}/hooks/{hook_id}"],
    uploadReleaseAsset: ["POST /repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}", {
      baseUrl: "https://uploads.github.com"
    }]
  },
  search: {
    code: ["GET /search/code"],
    commits: ["GET /search/commits", {
      mediaType: {
        previews: ["cloak"]
      }
    }],
    issuesAndPullRequests: ["GET /search/issues"],
    labels: ["GET /search/labels"],
    repos: ["GET /search/repositories"],
    topics: ["GET /search/topics", {
      mediaType: {
        previews: ["mercy"]
      }
    }],
    users: ["GET /search/users"]
  },
  teams: {
    addOrUpdateMembershipForUserInOrg: ["PUT /orgs/{org}/teams/{team_slug}/memberships/{username}"],
    addOrUpdateProjectPermissionsInOrg: ["PUT /orgs/{org}/teams/{team_slug}/projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    addOrUpdateRepoPermissionsInOrg: ["PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"],
    checkPermissionsForProjectInOrg: ["GET /orgs/{org}/teams/{team_slug}/projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    checkPermissionsForRepoInOrg: ["GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"],
    create: ["POST /orgs/{org}/teams"],
    createDiscussionCommentInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments"],
    createDiscussionInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions"],
    deleteDiscussionCommentInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"],
    deleteDiscussionInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"],
    deleteInOrg: ["DELETE /orgs/{org}/teams/{team_slug}"],
    getByName: ["GET /orgs/{org}/teams/{team_slug}"],
    getDiscussionCommentInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"],
    getDiscussionInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"],
    getMembershipForUserInOrg: ["GET /orgs/{org}/teams/{team_slug}/memberships/{username}"],
    list: ["GET /orgs/{org}/teams"],
    listChildInOrg: ["GET /orgs/{org}/teams/{team_slug}/teams"],
    listDiscussionCommentsInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments"],
    listDiscussionsInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions"],
    listForAuthenticatedUser: ["GET /user/teams"],
    listMembersInOrg: ["GET /orgs/{org}/teams/{team_slug}/members"],
    listPendingInvitationsInOrg: ["GET /orgs/{org}/teams/{team_slug}/invitations"],
    listProjectsInOrg: ["GET /orgs/{org}/teams/{team_slug}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listReposInOrg: ["GET /orgs/{org}/teams/{team_slug}/repos"],
    removeMembershipForUserInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}"],
    removeProjectInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/projects/{project_id}"],
    removeRepoInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"],
    updateDiscussionCommentInOrg: ["PATCH /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"],
    updateDiscussionInOrg: ["PATCH /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"],
    updateInOrg: ["PATCH /orgs/{org}/teams/{team_slug}"]
  },
  users: {
    addEmailForAuthenticated: ["POST /user/emails"],
    block: ["PUT /user/blocks/{username}"],
    checkBlocked: ["GET /user/blocks/{username}"],
    checkFollowingForUser: ["GET /users/{username}/following/{target_user}"],
    checkPersonIsFollowedByAuthenticated: ["GET /user/following/{username}"],
    createGpgKeyForAuthenticated: ["POST /user/gpg_keys"],
    createPublicSshKeyForAuthenticated: ["POST /user/keys"],
    deleteEmailForAuthenticated: ["DELETE /user/emails"],
    deleteGpgKeyForAuthenticated: ["DELETE /user/gpg_keys/{gpg_key_id}"],
    deletePublicSshKeyForAuthenticated: ["DELETE /user/keys/{key_id}"],
    follow: ["PUT /user/following/{username}"],
    getAuthenticated: ["GET /user"],
    getByUsername: ["GET /users/{username}"],
    getContextForUser: ["GET /users/{username}/hovercard"],
    getGpgKeyForAuthenticated: ["GET /user/gpg_keys/{gpg_key_id}"],
    getPublicSshKeyForAuthenticated: ["GET /user/keys/{key_id}"],
    list: ["GET /users"],
    listBlockedByAuthenticated: ["GET /user/blocks"],
    listEmailsForAuthenticated: ["GET /user/emails"],
    listFollowedByAuthenticated: ["GET /user/following"],
    listFollowersForAuthenticatedUser: ["GET /user/followers"],
    listFollowersForUser: ["GET /users/{username}/followers"],
    listFollowingForUser: ["GET /users/{username}/following"],
    listGpgKeysForAuthenticated: ["GET /user/gpg_keys"],
    listGpgKeysForUser: ["GET /users/{username}/gpg_keys"],
    listPublicEmailsForAuthenticated: ["GET /user/public_emails"],
    listPublicKeysForUser: ["GET /users/{username}/keys"],
    listPublicSshKeysForAuthenticated: ["GET /user/keys"],
    setPrimaryEmailVisibilityForAuthenticated: ["PATCH /user/email/visibility"],
    unblock: ["DELETE /user/blocks/{username}"],
    unfollow: ["DELETE /user/following/{username}"],
    updateAuthenticated: ["PATCH /user"]
  }
};

const VERSION = "4.2.1";

function endpointsToMethods(octokit, endpointsMap) {
  const newMethods = {};

  for (const [scope, endpoints] of Object.entries(endpointsMap)) {
    for (const [methodName, endpoint] of Object.entries(endpoints)) {
      const [route, defaults, decorations] = endpoint;
      const [method, url] = route.split(/ /);
      const endpointDefaults = Object.assign({
        method,
        url
      }, defaults);

      if (!newMethods[scope]) {
        newMethods[scope] = {};
      }

      const scopeMethods = newMethods[scope];

      if (decorations) {
        scopeMethods[methodName] = decorate(octokit, scope, methodName, endpointDefaults, decorations);
        continue;
      }

      scopeMethods[methodName] = octokit.request.defaults(endpointDefaults);
    }
  }

  return newMethods;
}

function decorate(octokit, scope, methodName, defaults, decorations) {
  const requestWithDefaults = octokit.request.defaults(defaults);
  /* istanbul ignore next */

  function withDecorations(...args) {
    // @ts-ignore https://github.com/microsoft/TypeScript/issues/25488
    let options = requestWithDefaults.endpoint.merge(...args); // There are currently no other decorations than `.mapToData`

    if (decorations.mapToData) {
      options = Object.assign({}, options, {
        data: options[decorations.mapToData],
        [decorations.mapToData]: undefined
      });
      return requestWithDefaults(options);
    }

    if (decorations.renamed) {
      const [newScope, newMethodName] = decorations.renamed;
      octokit.log.warn(`octokit.${scope}.${methodName}() has been renamed to octokit.${newScope}.${newMethodName}()`);
    }

    if (decorations.deprecated) {
      octokit.log.warn(decorations.deprecated);
    }

    if (decorations.renamedParameters) {
      // @ts-ignore https://github.com/microsoft/TypeScript/issues/25488
      const options = requestWithDefaults.endpoint.merge(...args);

      for (const [name, alias] of Object.entries(decorations.renamedParameters)) {
        if (name in options) {
          octokit.log.warn(`"${name}" parameter is deprecated for "octokit.${scope}.${methodName}()". Use "${alias}" instead`);

          if (!(alias in options)) {
            options[alias] = options[name];
          }

          delete options[name];
        }
      }

      return requestWithDefaults(options);
    } // @ts-ignore https://github.com/microsoft/TypeScript/issues/25488


    return requestWithDefaults(...args);
  }

  return Object.assign(withDecorations, requestWithDefaults);
}

/**
 * This plugin is a 1:1 copy of internal @octokit/rest plugins. The primary
 * goal is to rebuild @octokit/rest on top of @octokit/core. Once that is
 * done, we will remove the registerEndpoints methods and return the methods
 * directly as with the other plugins. At that point we will also remove the
 * legacy workarounds and deprecations.
 *
 * See the plan at
 * https://github.com/octokit/plugin-rest-endpoint-methods.js/pull/1
 */

function restEndpointMethods(octokit) {
  return endpointsToMethods(octokit, Endpoints);
}
restEndpointMethods.VERSION = VERSION;

exports.restEndpointMethods = restEndpointMethods;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 46:
/***/ (function(module) {

/**
 * Generated from https://translate.google.com
 *
 * The languages that Google Translate supports (as of 7/5/2020) alongside
 * their ISO 639-1 codes
 * @see https://cloud.google.com/translate/docs/languages
 * @see https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
 */

const languages = {
    "auto": "Automatic",
    "af": "Afrikaans",
    "sq": "Albanian",
    "am": "Amharic",
    "ar": "Arabic",
    "hy": "Armenian",
    "az": "Azerbaijani",
    "eu": "Basque",
    "be": "Belarusian",
    "bn": "Bengali",
    "bs": "Bosnian",
    "bg": "Bulgarian",
    "ca": "Catalan",
    "ceb": "Cebuano",
    "ny": "Chichewa",
    "zh-cn": "Chinese Simplified",
    "zh-tw": "Chinese Traditional",
    "co": "Corsican",
    "hr": "Croatian",
    "cs": "Czech",
    "da": "Danish",
    "nl": "Dutch",
    "en": "English",
    "eo": "Esperanto",
    "et": "Estonian",
    "tl": "Filipino",
    "fi": "Finnish",
    "fr": "French",
    "fy": "Frisian",
    "gl": "Galician",
    "ka": "Georgian",
    "de": "German",
    "el": "Greek",
    "gu": "Gujarati",
    "ht": "Haitian Creole",
    "ha": "Hausa",
    "haw": "Hawaiian",
    "iw": "Hebrew",
    "hi": "Hindi",
    "hmn": "Hmong",
    "hu": "Hungarian",
    "is": "Icelandic",
    "ig": "Igbo",
    "id": "Indonesian",
    "ga": "Irish",
    "it": "Italian",
    "ja": "Japanese",
    "jw": "Javanese",
    "kn": "Kannada",
    "kk": "Kazakh",
    "km": "Khmer",
    "ko": "Korean",
    "ku": "Kurdish (Kurmanji)",
    "ky": "Kyrgyz",
    "lo": "Lao",
    "la": "Latin",
    "lv": "Latvian",
    "lt": "Lithuanian",
    "lb": "Luxembourgish",
    "mk": "Macedonian",
    "mg": "Malagasy",
    "ms": "Malay",
    "ml": "Malayalam",
    "mt": "Maltese",
    "mi": "Maori",
    "mr": "Marathi",
    "mn": "Mongolian",
    "my": "Myanmar (Burmese)",
    "ne": "Nepali",
    "no": "Norwegian",
    "ps": "Pashto",
    "fa": "Persian",
    "pl": "Polish",
    "pt": "Portuguese",
    "pa": "Punjabi",
    "ro": "Romanian",
    "ru": "Russian",
    "sm": "Samoan",
    "gd": "Scots Gaelic",
    "sr": "Serbian",
    "st": "Sesotho",
    "sn": "Shona",
    "sd": "Sindhi",
    "si": "Sinhala",
    "sk": "Slovak",
    "sl": "Slovenian",
    "so": "Somali",
    "es": "Spanish",
    "su": "Sundanese",
    "sw": "Swahili",
    "sv": "Swedish",
    "tg": "Tajik",
    "ta": "Tamil",
    "te": "Telugu",
    "th": "Thai",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "ur": "Urdu",
    "uz": "Uzbek",
    "vi": "Vietnamese",
    "cy": "Welsh",
    "xh": "Xhosa",
    "yi": "Yiddish",
    "yo": "Yoruba",
    "zu": "Zulu"
};

/**
 * Returns the ISO 639-1 code of the desiredLang – if it is supported by
 * Google Translate
 * @param {string} language The name or the code of the desired language
 * @returns {string|boolean} The ISO 639-1 code of the language or null if the
 * language is not supported
 */
function getISOCode(language) {
    if (!language) return false;
    language = language.toLowerCase();
    if (language in languages) return language;

    let keys = Object.keys(languages).filter((key) => {
        if (typeof languages[key] !== "string") return false;

        return languages[key].toLowerCase() === language;
    });

    return keys[0] || null;
}

/**
 * Returns true if the desiredLang is supported by Google Translate and false otherwise
 * @param {String} language The ISO 639-1 code or the name of the desired language.
 * @returns {boolean} If the language is supported or not.
 */
function isSupported(language) {
    return Boolean(getISOCode(language));
}

module.exports = languages;
module.exports.isSupported = isSupported;
module.exports.getISOCode = getISOCode;


/***/ }),

/***/ 48:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const is_1 = __webpack_require__(678);
const normalizeArguments = (options, defaults) => {
    if (is_1.default.null_(options.encoding)) {
        throw new TypeError('To get a Buffer, set `options.responseType` to `buffer` instead');
    }
    is_1.assert.any([is_1.default.string, is_1.default.undefined], options.encoding);
    is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.resolveBodyOnly);
    is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.methodRewriting);
    is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.isStream);
    is_1.assert.any([is_1.default.string, is_1.default.undefined], options.responseType);
    // `options.responseType`
    if (options.responseType === undefined) {
        options.responseType = 'text';
    }
    // `options.retry`
    const { retry } = options;
    if (defaults) {
        options.retry = { ...defaults.retry };
    }
    else {
        options.retry = {
            calculateDelay: retryObject => retryObject.computedValue,
            limit: 0,
            methods: [],
            statusCodes: [],
            errorCodes: [],
            maxRetryAfter: undefined
        };
    }
    if (is_1.default.object(retry)) {
        options.retry = {
            ...options.retry,
            ...retry
        };
        options.retry.methods = [...new Set(options.retry.methods.map(method => method.toUpperCase()))];
        options.retry.statusCodes = [...new Set(options.retry.statusCodes)];
        options.retry.errorCodes = [...new Set(options.retry.errorCodes)];
    }
    else if (is_1.default.number(retry)) {
        options.retry.limit = retry;
    }
    if (is_1.default.undefined(options.retry.maxRetryAfter)) {
        options.retry.maxRetryAfter = Math.min(
        // TypeScript is not smart enough to handle `.filter(x => is.number(x))`.
        // eslint-disable-next-line unicorn/no-fn-reference-in-iterator
        ...[options.timeout.request, options.timeout.connect].filter(is_1.default.number));
    }
    // `options.pagination`
    if (is_1.default.object(options.pagination)) {
        if (defaults) {
            options.pagination = {
                ...defaults.pagination,
                ...options.pagination
            };
        }
        const { pagination } = options;
        if (!is_1.default.function_(pagination.transform)) {
            throw new Error('`options.pagination.transform` must be implemented');
        }
        if (!is_1.default.function_(pagination.shouldContinue)) {
            throw new Error('`options.pagination.shouldContinue` must be implemented');
        }
        if (!is_1.default.function_(pagination.filter)) {
            throw new TypeError('`options.pagination.filter` must be implemented');
        }
        if (!is_1.default.function_(pagination.paginate)) {
            throw new Error('`options.pagination.paginate` must be implemented');
        }
    }
    // JSON mode
    if (options.responseType === 'json' && options.headers.accept === undefined) {
        options.headers.accept = 'application/json';
    }
    return options;
};
exports.default = normalizeArguments;


/***/ }),

/***/ 53:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.Context = void 0;
const fs_1 = __webpack_require__(747);
const os_1 = __webpack_require__(87);
class Context {
    /**
     * Hydrate the context from the environment
     */
    constructor() {
        this.payload = {};
        if (process.env.GITHUB_EVENT_PATH) {
            if (fs_1.existsSync(process.env.GITHUB_EVENT_PATH)) {
                this.payload = JSON.parse(fs_1.readFileSync(process.env.GITHUB_EVENT_PATH, { encoding: 'utf8' }));
            }
            else {
                const path = process.env.GITHUB_EVENT_PATH;
                process.stdout.write(`GITHUB_EVENT_PATH ${path} does not exist${os_1.EOL}`);
            }
        }
        this.eventName = process.env.GITHUB_EVENT_NAME;
        this.sha = process.env.GITHUB_SHA;
        this.ref = process.env.GITHUB_REF;
        this.workflow = process.env.GITHUB_WORKFLOW;
        this.action = process.env.GITHUB_ACTION;
        this.actor = process.env.GITHUB_ACTOR;
        this.job = process.env.GITHUB_JOB;
        this.runNumber = parseInt(process.env.GITHUB_RUN_NUMBER, 10);
        this.runId = parseInt(process.env.GITHUB_RUN_ID, 10);
    }
    get issue() {
        const payload = this.payload;
        return Object.assign(Object.assign({}, this.repo), { number: (payload.issue || payload.pull_request || payload).number });
    }
    get repo() {
        if (process.env.GITHUB_REPOSITORY) {
            const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
            return { owner, repo };
        }
        if (this.payload.repository) {
            return {
                owner: this.payload.repository.owner.login,
                repo: this.payload.repository.name
            };
        }
        throw new Error("context.repo requires a GITHUB_REPOSITORY environment variable like 'owner/repo'");
    }
}
exports.Context = Context;
//# sourceMappingURL=context.js.map

/***/ }),

/***/ 56:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __webpack_require__(614);
const is_1 = __webpack_require__(678);
const PCancelable = __webpack_require__(72);
const types_1 = __webpack_require__(597);
const parse_body_1 = __webpack_require__(220);
const core_1 = __webpack_require__(94);
const proxy_events_1 = __webpack_require__(21);
const get_buffer_1 = __webpack_require__(500);
const is_response_ok_1 = __webpack_require__(298);
const proxiedRequestEvents = [
    'request',
    'response',
    'redirect',
    'uploadProgress',
    'downloadProgress'
];
function asPromise(normalizedOptions) {
    let globalRequest;
    let globalResponse;
    const emitter = new events_1.EventEmitter();
    const promise = new PCancelable((resolve, reject, onCancel) => {
        const makeRequest = (retryCount) => {
            const request = new core_1.default(undefined, normalizedOptions);
            request.retryCount = retryCount;
            request._noPipe = true;
            onCancel(() => request.destroy());
            onCancel.shouldReject = false;
            onCancel(() => reject(new types_1.CancelError(request)));
            globalRequest = request;
            request.once('response', async (response) => {
                var _a;
                response.retryCount = retryCount;
                if (response.request.aborted) {
                    // Canceled while downloading - will throw a `CancelError` or `TimeoutError` error
                    return;
                }
                // Download body
                let rawBody;
                try {
                    rawBody = await get_buffer_1.default(request);
                    response.rawBody = rawBody;
                }
                catch (_b) {
                    // The same error is caught below.
                    // See request.once('error')
                    return;
                }
                if (request._isAboutToError) {
                    return;
                }
                // Parse body
                const contentEncoding = ((_a = response.headers['content-encoding']) !== null && _a !== void 0 ? _a : '').toLowerCase();
                const isCompressed = ['gzip', 'deflate', 'br'].includes(contentEncoding);
                const { options } = request;
                if (isCompressed && !options.decompress) {
                    response.body = rawBody;
                }
                else {
                    try {
                        response.body = parse_body_1.default(response, options.responseType, options.parseJson, options.encoding);
                    }
                    catch (error) {
                        // Fallback to `utf8`
                        response.body = rawBody.toString();
                        if (is_response_ok_1.isResponseOk(response)) {
                            request._beforeError(error);
                            return;
                        }
                    }
                }
                try {
                    for (const [index, hook] of options.hooks.afterResponse.entries()) {
                        // @ts-expect-error TS doesn't notice that CancelableRequest is a Promise
                        // eslint-disable-next-line no-await-in-loop
                        response = await hook(response, async (updatedOptions) => {
                            const typedOptions = core_1.default.normalizeArguments(undefined, {
                                ...updatedOptions,
                                retry: {
                                    calculateDelay: () => 0
                                },
                                throwHttpErrors: false,
                                resolveBodyOnly: false
                            }, options);
                            // Remove any further hooks for that request, because we'll call them anyway.
                            // The loop continues. We don't want duplicates (asPromise recursion).
                            typedOptions.hooks.afterResponse = typedOptions.hooks.afterResponse.slice(0, index);
                            for (const hook of typedOptions.hooks.beforeRetry) {
                                // eslint-disable-next-line no-await-in-loop
                                await hook(typedOptions);
                            }
                            const promise = asPromise(typedOptions);
                            onCancel(() => {
                                promise.catch(() => { });
                                promise.cancel();
                            });
                            return promise;
                        });
                    }
                }
                catch (error) {
                    request._beforeError(new types_1.RequestError(error.message, error, request));
                    return;
                }
                if (!is_response_ok_1.isResponseOk(response)) {
                    request._beforeError(new types_1.HTTPError(response));
                    return;
                }
                globalResponse = response;
                resolve(request.options.resolveBodyOnly ? response.body : response);
            });
            const onError = (error) => {
                if (promise.isCanceled) {
                    return;
                }
                const { options } = request;
                if (error instanceof types_1.HTTPError && !options.throwHttpErrors) {
                    const { response } = error;
                    resolve(request.options.resolveBodyOnly ? response.body : response);
                    return;
                }
                reject(error);
            };
            request.once('error', onError);
            const previousBody = request.options.body;
            request.once('retry', (newRetryCount, error) => {
                var _a, _b;
                if (previousBody === ((_a = error.request) === null || _a === void 0 ? void 0 : _a.options.body) && is_1.default.nodeStream((_b = error.request) === null || _b === void 0 ? void 0 : _b.options.body)) {
                    onError(error);
                    return;
                }
                makeRequest(newRetryCount);
            });
            proxy_events_1.default(request, emitter, proxiedRequestEvents);
        };
        makeRequest(0);
    });
    promise.on = (event, fn) => {
        emitter.on(event, fn);
        return promise;
    };
    const shortcut = (responseType) => {
        const newPromise = (async () => {
            // Wait until downloading has ended
            await promise;
            const { options } = globalResponse.request;
            return parse_body_1.default(globalResponse, responseType, options.parseJson, options.encoding);
        })();
        Object.defineProperties(newPromise, Object.getOwnPropertyDescriptors(promise));
        return newPromise;
    };
    promise.json = () => {
        const { headers } = globalRequest.options;
        if (!globalRequest.writableFinished && headers.accept === undefined) {
            headers.accept = 'application/json';
        }
        return shortcut('json');
    };
    promise.buffer = () => shortcut('buffer');
    promise.text = () => shortcut('text');
    return promise;
}
exports.default = asPromise;
__exportStar(__webpack_require__(597), exports);


/***/ }),

/***/ 61:
/***/ (function(module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
const url_1 = __webpack_require__(835);
const create_1 = __webpack_require__(337);
const defaults = {
    options: {
        method: 'GET',
        retry: {
            limit: 2,
            methods: [
                'GET',
                'PUT',
                'HEAD',
                'DELETE',
                'OPTIONS',
                'TRACE'
            ],
            statusCodes: [
                408,
                413,
                429,
                500,
                502,
                503,
                504,
                521,
                522,
                524
            ],
            errorCodes: [
                'ETIMEDOUT',
                'ECONNRESET',
                'EADDRINUSE',
                'ECONNREFUSED',
                'EPIPE',
                'ENOTFOUND',
                'ENETUNREACH',
                'EAI_AGAIN'
            ],
            maxRetryAfter: undefined,
            calculateDelay: ({ computedValue }) => computedValue
        },
        timeout: {},
        headers: {
            'user-agent': 'got (https://github.com/sindresorhus/got)'
        },
        hooks: {
            init: [],
            beforeRequest: [],
            beforeRedirect: [],
            beforeRetry: [],
            beforeError: [],
            afterResponse: []
        },
        cache: undefined,
        dnsCache: undefined,
        decompress: true,
        throwHttpErrors: true,
        followRedirect: true,
        isStream: false,
        responseType: 'text',
        resolveBodyOnly: false,
        maxRedirects: 10,
        prefixUrl: '',
        methodRewriting: true,
        ignoreInvalidCookies: false,
        context: {},
        // TODO: Set this to `true` when Got 12 gets released
        http2: false,
        allowGetBody: false,
        https: undefined,
        pagination: {
            transform: (response) => {
                if (response.request.options.responseType === 'json') {
                    return response.body;
                }
                return JSON.parse(response.body);
            },
            paginate: response => {
                if (!Reflect.has(response.headers, 'link')) {
                    return false;
                }
                const items = response.headers.link.split(',');
                let next;
                for (const item of items) {
                    const parsed = item.split(';');
                    if (parsed[1].includes('next')) {
                        next = parsed[0].trimStart().trim();
                        next = next.slice(1, -1);
                        break;
                    }
                }
                if (next) {
                    const options = {
                        url: new url_1.URL(next)
                    };
                    return options;
                }
                return false;
            },
            filter: () => true,
            shouldContinue: () => true,
            countLimit: Infinity,
            backoff: 0,
            requestLimit: 10000,
            stackAllItems: true
        },
        parseJson: (text) => JSON.parse(text),
        stringifyJson: (object) => JSON.stringify(object),
        cacheOptions: {}
    },
    handlers: [create_1.defaultHandler],
    mutableDefaults: false
};
const got = create_1.default(defaults);
exports.default = got;
// For CommonJS default export support
module.exports = got;
module.exports.default = got;
module.exports.__esModule = true; // Workaround for TS issue: https://github.com/sindresorhus/got/pull/1267
__exportStar(__webpack_require__(337), exports);
__exportStar(__webpack_require__(56), exports);


/***/ }),

/***/ 62:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

/*!
 * is-plain-object <https://github.com/jonschlinkert/is-plain-object>
 *
 * Copyright (c) 2014-2017, Jon Schlinkert.
 * Released under the MIT License.
 */

function isObject(o) {
  return Object.prototype.toString.call(o) === '[object Object]';
}

function isPlainObject(o) {
  var ctor,prot;

  if (isObject(o) === false) return false;

  // If has modified constructor
  ctor = o.constructor;
  if (ctor === undefined) return true;

  // If has modified prototype
  prot = ctor.prototype;
  if (isObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
}

exports.isPlainObject = isPlainObject;


/***/ }),

/***/ 65:
/***/ (function(module, exports) {


exports = module.exports = trim;

function trim(str){
  return str.replace(/^\s*|\s*$/g, '');
}

exports.left = function(str){
  return str.replace(/^\s*/, '');
};

exports.right = function(str){
  return str.replace(/\s*$/, '');
};


/***/ }),

/***/ 72:
/***/ (function(module) {

"use strict";


class CancelError extends Error {
	constructor(reason) {
		super(reason || 'Promise was canceled');
		this.name = 'CancelError';
	}

	get isCanceled() {
		return true;
	}
}

class PCancelable {
	static fn(userFn) {
		return (...arguments_) => {
			return new PCancelable((resolve, reject, onCancel) => {
				arguments_.push(onCancel);
				// eslint-disable-next-line promise/prefer-await-to-then
				userFn(...arguments_).then(resolve, reject);
			});
		};
	}

	constructor(executor) {
		this._cancelHandlers = [];
		this._isPending = true;
		this._isCanceled = false;
		this._rejectOnCancel = true;

		this._promise = new Promise((resolve, reject) => {
			this._reject = reject;

			const onResolve = value => {
				this._isPending = false;
				resolve(value);
			};

			const onReject = error => {
				this._isPending = false;
				reject(error);
			};

			const onCancel = handler => {
				if (!this._isPending) {
					throw new Error('The `onCancel` handler was attached after the promise settled.');
				}

				this._cancelHandlers.push(handler);
			};

			Object.defineProperties(onCancel, {
				shouldReject: {
					get: () => this._rejectOnCancel,
					set: boolean => {
						this._rejectOnCancel = boolean;
					}
				}
			});

			return executor(onResolve, onReject, onCancel);
		});
	}

	then(onFulfilled, onRejected) {
		// eslint-disable-next-line promise/prefer-await-to-then
		return this._promise.then(onFulfilled, onRejected);
	}

	catch(onRejected) {
		return this._promise.catch(onRejected);
	}

	finally(onFinally) {
		return this._promise.finally(onFinally);
	}

	cancel(reason) {
		if (!this._isPending || this._isCanceled) {
			return;
		}

		if (this._cancelHandlers.length > 0) {
			try {
				for (const handler of this._cancelHandlers) {
					handler();
				}
			} catch (error) {
				this._reject(error);
			}
		}

		this._isCanceled = true;
		if (this._rejectOnCancel) {
			this._reject(new CancelError(reason));
		}
	}

	get isCanceled() {
		return this._isCanceled;
	}
}

Object.setPrototypeOf(PCancelable.prototype, Promise.prototype);

module.exports = PCancelable;
module.exports.CancelError = CancelError;


/***/ }),

/***/ 73:
/***/ (function(module) {

module.exports = {"Latin":{"spa":" de|os |de | la|la | y | a |es |ón |ión|rec|ere|der| co|e l|el |en |ien|ent|cho|ech|ció|aci|o a|a p| el|al |a l|as |e d| en|ona|na |da |s d|nte| to|ad |ene|con| su| pr|tod| se|ho | pe|los|per|ers| lo| ti|cia|o d|n d|a t|cio|ida|res| es|tie|ion|rso|te | in|do |to |son|dad| re| li|e s|tad|que|pro|est|oda|men|nci| po|a e| qu|ue | un|ne |s y|lib|n e|su | na|s e|ia |nac|e e|tra|or | pa|ado|a d|nes|se |ra |a c|com|nal|por|er |a s|ual|rta| o |ber|les|one|rá |des|s p|dos|sta|ser|ter|ar |era|ibe|ert|ale| di|a a|nto|l d|del|ica|hos|o e|io |imi|oci|n c|s n|ant|cci|re |e c|y l|ame| as|mie|enc| so|o s|ici|las|par|s t|ndi| cu|ara|dic|bre|una|tos|ntr|l p|s l|e a|pre|cla|o t|a y|omo|man|y a|ial|so |nid|n l|n p| al|mo |e p|s s| ig|igu|gua|uma| fu|nta|y e|soc|o p|no |ali|ten|s a|ade|hum|ran|l t|n t|s c|ria|dis|d d| ca|cas|das|ada|ido|l e|y d|tiv|vid|mbr|a i| hu|fun|und|eli|s i| ma|nda|e i| ha|uni|nad|a u|sar|s o| ac|die|qui|rac|ndo| tr|ind| me|ori|tal|odo|ari|lid|esp|o y|tic|ca |un |esa|cti|cua|ier|ta |lar|ons|ont|iva|ide|med|edi|d y|ele|nos|ist|l m|s h|ecc|sti|tor| le|seg|cie|r e|n a|ito|ios|rse|ie |o i|a o|o l|pen|tri|rim|l y|ami|lig|erá|o c|rot|ote|mat|ond|ern|n s|e h|an |ect|lo |ibr|ple|sus|us ","eng":" th|the| an|he |nd |and|ion| of|of |tio| to|to |on | in|al |ati|igh|rig|ght| ri|or |ent|as |ll |is |ed |in | be|e r|ne |ver|one|s t|all|eve|t t| fr| ha| re|s a|ty |ery|d t| pr| or|e h| ev| co|ht |e a|ng |his|ts |yon|be |ing|ce |ryo| sh|n t|fre|ree|men|her|pro|has|nal|sha|es |nat|y a|for| hi|hal|n a|f t|nt | pe|n o|s o| fo|nce|d i|er |e s|res|ect|ons|ity|l b|ly |e e|ry |an |e o|ter|ers|e i| de|cti|hts|eed|edo|dom| wh|ona|re | no|l a| a |e p| un| as|ny |d f| wi|nit| na|nte| en|d a|any|ere|ith| di|e c|e t|st |y t|ns |ted|sta|per|th |man|ve |om |nti|s e|t o|ch | ar|d o|equ|soc|oci|wit|ess|ote|ial|rea| al| fu| on| so|uni|oth| ma| ac| se|enc| eq|qua|ual|ive|lit|thi|int| st|tat|r t|t a|y o|e w|hum|uma|und|led|cia|l o|e f| is|le |f h| by|by | la|ali|are|y i|con|te | wo|eas| hu|ave|o a|com| me|ic |r a|ge |f a|ms |whe| ch|en |n e|rot|tec|tit|s r| li|o t|ple|s d|rat|ate|t f|o o|wor| fa|hou|dis|t i|nda|nde|eli|anc|rom| su|cie|no |ary|inc|son|age|at |oms|oun|nst|s w|d w|ld |n p|nta|l p|tan|edu|n s|duc|itl|tle|whi|hic|ich|ble|o s|imi|min|law|aw |gni|iti| ot|g t|eme|se |e b|ntr|tra| pu|d n|s i|act|e d|ort| he|r s|cou|unt|pen|ily| ag|ces|rit|it |din|s f|hav|ind| ed|uca|cat|ren|ien|tho|ern|d e|omm","por":"os |de | de| a | e |o d|to |ão | di|ent|da |ito|em | co|eit|as |dir|ire|es |rei| se|ção|ade|a p|e d|s d|dad|men|nte|do |s e| pe| pr|dos| to| da|o e| o |a a|o a|ess|tod|con| qu|que| do|e a|te |al |res|ida|m d| in|er | ou|sso| re| na|a s| po|uma| li|cia| te|pro|açã|e e|ar |a d|a t|ue | su| es|ou |s p|a e|tos|des|com|ra |ia |tem|no | pa|ame|nto|e p|is |est|oda|na |s o|tra|ões|das|pes|soa|o s|s n|o p|ser|s a| à |ais| as| em|o o|e o|ber|oa |o t|ado|a c|sua|ua | no|ter|man|e s| os|s s|e n|çõe|ica|lib|ibe|erd|rda|nci|odo|nal|so |ntr|or |ura|s t|o c|ona| so| ao|hum|ual|sta|ma |ons|a n|era|e t|pre|ara|r a|por| hu|cio|o à|ria|par|ind|e c|ran|gua| um|o i|a l|s c|ndi|m a| en|und|nos|e r|ano|aci|ion|soc|oci|nid|sen|raç| ac|ndo|nsi| ig|igu| fu|fun|m o|nac|per|ali|rec|ime|ont|açõ|int|r p| al|um | me|a i|s h|nta|rio|cçã|ere|pel|l d|a o| ex|pri|uni|ese|ada| ma|ant|ide|nda| fa|am |e f|lid|io |ém |ita|iva|omo|o r|esp|a f|m p|lic|ca |s f|naç|pod|ode|ver|a q|r e|tad|tiv|vid|e l|o q|r d|e i|seu|eli|mo |ecç|s i|ial|ing|ngu|s l| vi|ist|ta |eci|ênc|a m| ca|der|ido|ios| un|dis|cla|qua|se |ati|sti|r o|sid|roc| tr|sem|o n|ao |dam|ens|tur|ico|rot|ote|tec|sse|l e|ena|for| pl| ni|nin|gué|uém|não|ela|tro|ros|ias","ind":"an |ang| da|ng | pe|ak | ke| me| se|ata|dan|kan| di| be|hak|ber|per|ran|nga|yan|eng| ya| ha|asa|men|gan|ara|nya|n p|n d|n k|a d| at|tan|at |ora|ala| ba|san|erh|ap |ya |rha|n b| ma|a s|pen|g b|eba|as |aan| or|ntu|uk |eti|tia|tas|aka|set|ban|n s| un|n y| te|ter|iap|tuk|k m|beb|bas|lam| de|n m|k a|keb|am |i d|ama|unt|ah |dal|end|n h|p o|den|sa |dak|mem|ika|ra |ebe|pun|ri |nda|ela|ma | sa|di |a m|n t|k d|ngg|n a|tau|asi| ti|eri|gar|man|ada|al |um |un |ari|au |lak|a p|ta |a b|ngs|ole| ne|neg|dar|ers|gsa|ida|leh|ert|k h|ana|sam|sia|i m|ia |dap|era|dil|ila|tid|eh |h d|atu|bat|uka|aha|a a|ai |g d|lan|tu |t d|uan| in|ena|har|sem|ser|kat|erl|apa|erb|uat|na |kum|g s|ung|nan|emp|rta|l d|mas|ega|n u| hu|ka |eni|pat|mba|adi| su|aga|ent|nta|huk|uku|rga|ndi|ind|i s|ar |sua|aku|rus|n i|ni |car|si |nny|han| la|in |u d|lah|ik |gga|ua |ian|ann|lai|usi|emb|rik|mer|erk|arg|emu|dun|dip|nas|lua|aru|ema|a u|min|mat|aya|kes|rak|eka|a t|rka|a k|iba|rbu|rma|yat|ini|ina|anu|nus|mua|s p|ut |lin| ta|us |ndu|da |pem|ami|sya|yar|nak|das|k s|kel|ese|mel| pu|ern|a n|aik|uar|t p|g p|ant|ili|dik| an|tin|ing|ipe|tak|iny|ain| um| ja|aks|sar|rse|aup|upu|seo|eor|g m|g t|dir|pel|ura|bai|aba|erd|eca|h p|kep|m m|jam|umu|mum","fra":" de|es |de |ion|nt |et |tio| et|ent| la|la |e d|on |ne |oit|le |e l| le|s d|t d|ati|e p|roi|it | dr|dro| à | co|té |ns |te |e s|men|re | to|tou| l’|con|que|les| qu| so| pe|des|son|ons|s l| un| pr|ue |s e| pa|e c|ts |t l|onn| au|e a|e e|eme| li|ant|ont|out|ute|ers|res|t à| sa| a |ce |per|tre|a d|er |cti| en|ité|lib| re|en |ux |lle|rso| in| ou|un |à l|nne|nat|une|ou |n d|us |par|nte|ur | se| d’|dan|ans|s s|pro|e t|s p|r l|ire|a p|t p|its|és |ond|sa |a l|nce|é d| dé|nal|aux|omm|me |ert| fo| na|iqu|ect|ale| da| ce|t a|s a|mme|ibe|ber|rté|s c|e r|al |t e| po|our|com|san|qui|e n|ous|r d| ne|fon|au |e o|ell|ali|lit| es| ch|iss|tes|éra|air|s n| di|ter|ui | pl|ar |aut|ien|soc|oci|tra|rat|êtr|int|été|pou|du |est|éga|ran|ain|s o|eur|ona|rs |anc|n c|rai|pri|cla|age|nsi|e m|s t| do|bre|sur|ure|ut | êt| ét|à u|ge |ess|ser|ens| ma|cia|l e| su|n p|a c|ein|st |bli| du|ntr|rés|sen|ndi|ir |n t|a s|soi| ég|ine|l’h|nda|rit| ré|t c|s i|il |l’a|e q| te|é e|t s|qu’|ass|ais|cun|peu|ée |tat|ind|t q|u d|n a| ac|tés|idé|l n|ill| as|’en|ign|gal|hom|nta| fa|lig|ins| on|ie |rel|ote|t i|n s|sse| tr|n e|oir|ple|l’e|s é|ive|a r|rec|nna|ssa| mo|s u|uni|t ê|pré|act| vi|era|sid| nu|e f|pay|’ho|cat|leu|ten|rot|tec|s m","deu":"en |er |der| un|nd |und|ein|ung|cht| de|ich|sch|ng | ge|ie |che| di|die|ech|rec|gen|ine|eit| re| da|ch |n d|ver|hen| zu|t d| au|ht | ha|lic|it |ten|rei| be|in | ei| in| ve|nde|auf|ede|den|n s|zu |uf |ter|ne |fre| je|jed|es | se| an|n u|and|sei|run| fr|at |s r|das|hei|hte|e u|ens|r h|nsc|as |nge| al|ere|hat|men|lle|nte|rde|t a|ese|ner| od|ode| we|g d|n g|all|t u|ers| so|d d|n a|nen|te |lei| vo|wer| gr|ben|ige|e a|ion| st|ege|le |cha| me|ren|n j|haf|aft| er|erk|bei|ent|erd| si|kei|tig|eih|ihe|r d|len|on |n i|lun| gl|chu|e s|ist|st |unt|ern|tli|gem|ges|ft |ati|tio|gru|end|ies|mit|eic|sen|r g|e e|ei | wi|n n| na|sta|gun|ite|n z|r s|gle|chl|lie|mei|em |uch|nat|n w|urc|rch|de |hre| sc|sse|ale|ach|r m|des|n e|spr|t w|r e|d f| ni| du|dur|nie| mi|ied|fen|int|dar|e f|e g|geh|e d|f g|t s|ang|ste|hab|abe|h a|n v|alt|tz |hli|sic|her|nun|eme|ruc|taa|aat|he |e m|erf|ans|geg| is|tun|pru|d g|arf|rf |n o|ndl|ehe|e b|h d|d s|dig|arb|wie|r b| ih|r w|nsp|ber|t i|r a|r v|igk|gke|bes|n r|str|gew|rbe|ema|e v|n h| ar|rt |ind|n f|ins|esc|ieß|ken|ger|eru|ffe|ell|han|igu|man|sam|t g|ohn|hul|rst|tra|rli|lte|hut|utz|ls |ebe|von|r o|e i|nne|etz|d a|rn |isc|sel| fa|one|son|et |aus|r i|det|da |raf|iem|e z|lan|sow","jav":"ng |an |ang| ka|ing|kan| sa|ak |lan| la|hak| ha| pa| ma|ngg|ara|sa |abe|ne | in|ant|n k| ng|nin|tan|nga| an|ata|en |ran|man| ba|ban|ane|ong|ra |n u|hi |nth| da|ake|ke |thi|ung|uwo|won|ngs| uw|asa|ben|gsa|sab|ana|aka|beb|nan|a k|nda|g p|adi|at |awa|san|ni |pan| be|dan|eba|g k|e k|ani|bas|g s|dha|aya| pr|gan|mar|di |ya |wa |g u|n s|ta |a s| wa|arb|e h| na|a n|a l|n p|a b|yan| ut|n n|ah |asi| um|g d|as |han|g n| tu|dar|rbe|wen|ggo| di|dak|mat|sar|eni| un|und|iya|a a|k h|kab|ka |be |uma|art|ora|ngk|i h|ala|rta|n b| or|n m|gar|kar|yat|al |g b|na |a m|n i|ega|ina|kak|g a|pra| ta|gge|ger|ena|kat|kal|a p|i k|tum|oni|nya| ne|adh|g m|duw|uwe|dad|kas| pe| si|aga|uta|k k|pa |and|nun|i l|ngu|go |nal| ke|n a|uju|anu|ama|a d|i p|t m|er | li|per|iba|min|sak|apa|war|ha |pad|ggu|gay|ras|taw|ind|eng|a u|we | bi|n l|ali|awi|neg|awe|bak|g t|e p|ndu|bis| ku|ih |ase| me|iji|pri|bad|eh |i t|uwa|ron|ndh|mra|ar | pi|ur |isa|mba|sin|aba|g l|ebu|n t|ika|men|ini|lak|a w|arg|ku |ami|ayo|a i|nas|liy|e s| we|rib|ngl| ik|k b|e d|rga|rap|tin| lu|aku|bed|k a|h k|yom| as| nd|eka|il | te|umu|rak|ut |dil|i w|i s|jin|kon|jud|wae|ae |kap|uha|uto|tow|gka|umr|n d| ti|eda|gon|ona| mi|ate|mum|um |but|r k|wat|si |k p|k l|gaw","vie":"ng |̣c |́c | qu| th|à |nh | ng|̣i | nh| va|và|̀n |uyê| ph| ca|quy|yề|ền|̀i | ch|̀nh| tr| cu|ngư|i n|gươ|ườ|ời|́t | gi| co|ác|̣t |ó |c t|ự |n t|cá|ông| kh|ượ|ợc| tư| đư|đươ|iệ|ìn|́i | ha| đê|i đ|có|gia| mo|mọ|ọi|như|pha|n n|củ|ủa|̉a |̣n | ba|n c|̀u |̃ng|ân |ều| bi|hôn|ất|tự|g t| vi|n đ|đề|t c| la| ti|nhâ| đô|u c|hiê|bả|ên | tô|hân| do|do |́ q|ch |̀ t| na|́n |ới|ay | hi|àn|̣ d| đi|g n|hay|há| mô|ội|hữ|uố|ốc|n v|̣p |́p |quô|thư| ho|nà|ị |́ch|̀ng|ào|̀o |̉n |ôn |i c| hô|c đ|i v|khô|c h|i t|g v| đa|mộ|ột|́ng|tro|ữn|ướ|ia |̣ng|ản|̉ng|h t|hư |ện|ộc|g c|ả | đo|̉ c|là|c c|n h|n b|hà|iế|̣ t| cô| vê|ức|t t|ã |hộ| vơ|iên|g đ|̉i | bâ|̀y |ớc|a c|̉m | sư|áp|ật|viê|vớ|hươ|tha|ực|h v|ron|ong|g b|qua|iá|̀ c|ể |h c|a m|ế |uậ|ảo|̉o |sự|o v|cho|phâ|n l| mi|hạ|côn|o c|̃ h| cư|ục|̀ n| hơ|i h|c q|á |ại|bị|cả|c n| lu|ín|h đ| xa|g h|độ|bấ| nư|m v|thô| tâ|tộ|hả|oà|áo|́o |ốn|ệ |thu|mì| du|̣ c|xã|c p|ải| hư|́ c|ho |y t|o n|n p|ở |hứ|iể|y đ|hấ|ối|chi|án|ề |́ t|ệc|cũ|ũn|tiê|hợ|ợp|o h|hoa|ày|ai |ết|̉ n|c b|đó| đâ|luâ|đố|kha|về|̉ t|c l|̀ đ|i b|nươ| bă|dụ|họ| ta|thê|tri|hí|́nh|g q|p q|n g|o t|c g|hự|yên|i l|́u |an | cơ","ita":" di|to |ion| de| in|la |e d|ne |di | e |zio|re |le |ni |ell|one|lla|a d|rit|o d|itt|del| co|dir|iri|ti |ess|ent| al|azi|tto|te |i d|i i|ere|tà | pr|ndi|e l|ale|ind|o a|e e|gni|e i|nte|con|li |a s| un|i e|ogn|men|uo | og| ne|idu|ivi|e a|div|vid|duo| ha|tti| es|a p|no | li|za |pro|ato|all|sse|per|ser| so|i s| la| su|e p| pe|a l|na |ibe|ali| il|il |e n|lib|ber|e c|ia |ha |che|e s|o s|o e| qu|in |nza|ta |nto| ri|he |o i|oni|sta| o | a |o c|nel|e o|naz|so |o p|o h|gli| po|i u|ond|i p|ame|ers|i c|ver|ro |ri |era|un |lle|a c|ua | ch|ssi|una|el |i a|ert|rtà| l |a a|tat|ant|dis|ei |a e| si| ad|à e|nal| da| le|est|pri|nit|ter|ual| st|ona|are|ità|dei|cia|gua|anz|tut| pa|al | ed| re|sua|ono| na|uni|raz|si |ita|com|ist|man|ed |der|ad |i o|enz|soc|que|res| se|o o|ese| tu|i r|io |ett|à d|on |dic|sia|rso|se |uma|ani|rio|ari|ial|eri|ien|ll |oci|rat|tra|ich|pre|qua|do | um|a t|i l|zza|sci|tri|er |ico|pos|a n|ara|o n|son|att| fo|fon|nda|utt|par|nti|sti|nes|n c| i |chi|hia|iar|int|sen|e u|str|uzi|ati|a r|rop|opr|egu| me|ra |ann| ma| eg|ost|bil|isp|ues| no|ont|rà |tta|ina|ezz|l i|tal| ra|gio|nno|a i|d a|i m|ria| cu|ore|e r|izi|dev|tan|lit|cie|non|sso|sun|ite|ica|l d|ide|lia|cos|i n|nta|a f| is|l p|art","tur":" ve| ha|ve |ler|lar|ir |in |hak| he|her|bir|arı|er |an |eri| bi|ya |r h|ak |ın |eti|iye|ası| ka|yet| ol|tle|ını|ara|eya|akk|kkı|etl|sın|na |esi|de |ek | ta|nda|ini| bu|rın|ile|vey|kla|rin|ne |e h|ır |ine|e k|ına|sin|dır|ere| sa|n h|ama|ınd|nın|mas| ge|le |ı v| va|erk|rke|lma|nma|lan| te|tin|akl|rle|nin|en |e m|ard|a v|ill| de|let|da |k h| me|aya| şa|k v| hü|riy|e b|kın|nı |et |dan|san|e d|var|rdı|kes|si |mil|e a| il|hür|ana|ret|dir| se|şah|mes|irl| mi|ola|bu |ürr|rri|n e|n i|kı |n v|mek| ma|mak|lle|lik|nsa|li |ı h| iş| ed| iç|n b|kar| ba|ala| hi|eli|ulu|a h|eme|re |e s|ni |e t|n k|a b|iş |rak|evl|e i|etm|ik |r ş|ar | eş|olm|un |hai|aiz|izd|zdi|im |dil|n t|nde| gö|ilm|lme|tir|mal|hiç|e g|unm|ma |ele|a i|e e|eşi|şit|ık |mel| et| ko|n s|ahs|i v|sı | an|el |yla|la |ili|r v|rı |anı|ede|ket| ya|lun|may|se |ins|tim|edi|siy|t v|içi|çin|a k|nla|r b|miş|i b|yan|ame|tme| da|bul|mem|eml|eke|mle| ki| ke|lek| in| di|din|uğu|n m|it |ser|ind| mü|arş|rşı|es |ger|a s|len| ay| ku|vle|erd|eye|ye |oru|nam|ken| uy|a m|ün |r a|i i|tür|i m|kor| so|al |hsı|cak|rme|nun|lam|eni|dev|rde|ri |mey|a d|i o|kim|ims|mse|end|ndi|rek|ahi|il |hay|lık|e v|iç |sız| öğ|öğr|ğre| bü|büt|ütü|tün|anl|alı|şma|k g|at |den|i s","pol":" pr|nie| i |ie |pra| po|ani|raw|ia |nia|go |wie| do|ch |ego|iek|owi| ni|ści|ci |awo|a p|do | cz|ośc|ych| ma|ek |rze|prz| na|wo | za| w |ej |noś|czł|zło|eni| je|wa |łow|i p|wol|oln| lu|rod| ka|wsz| wo|lno|y c|ma |każ|ażd|ny |dy |o d|stw|owa|żdy| wy|rzy|ecz|sta| sw|e p|twa|czn|dzi|i w|szy|zys|na |ów |lub|ub |a w|k m|est| sp|kie|wan|ają| ws|pow|e w|spo|nyc|pos|rac|a i|cze|yst|ać |neg|sze|ne |mi |aro|ńst| ja|jak|o p|pod| z |acj|obo| ko|i i|nar|i n| ro|awa| ró|zy |dow|zen|zan|zne|zec|jąc|iej|cy |rów|nej|odn|nic|czy|o s|no |ony|aw |i z|ówn|odz|jeg|o w|edn|o z|aki|o o|a s| st|ni |bez|owo| in|ien|eńs|ami| or|dno|zie|mie| ob|kol|stę|tęp|i k|ez |w c|poł|ołe|łec|ym |orz|jed|o u| os|olw|lwi|wia|ka |owy|owe|y w| be|o n|jes|wob|wyc|a j| od|zna|inn|zyn|aln|któ|cji|ji |się|i s|raz|y s|lud| kr|ją |cza|zes|nik|st |swo|a o|sza|ora|icz|kra|a z|h p|i o|ost|roz|war|ara|że |lni|raj| si|ię |e o|a n|em |eka|stk|tki|pop|ą p|iec|ron|kow|odo|w p|peł|ełn|ran|wni|dni|ows|ech|gan|dów|zon|pie|a d|i l| kt|tór|ini|ejs| de|dek|ywa|iko|z w|god|ków|adz|dst|taw| to|trz|e i|ich|dzy|by |bod|iu |nan|h i|chn|zeń|y z|ano|udz|ieg|w z|ier|ale|a k|z p|zaw|ekl|kla|lar|any|du | zw| go|o r|to |az |y n|ods|ymi|ju |och|nau|wej|i m","gax":"aa |an |uu | ka|ni |aan|umm|ii |mma|maa| wa|ti | fi|nam|ta |tti| na|saa| mi|fi |rga|i k|a n| qa|dha|iyy|oot|mir|irg|in |raa|qab|a i|kan|a k|isa|chu|akk|amu|aba|a f|huu|kam| ta|kka|amn|ami| is|a a|mni|att| bi|yaa|ach|yyu|yuu|ee |miy|wal|waa|ga |aat|ata|a e|tii|oo | ni| ee|moo|ba |ota| ak|a h| ga|i q| dh|daa|a m|haa|ama|i a|a b|yoo|ka |kaa| hi|aas|sum|u n| uu|arg| hu|man| ha| ar| ke| yo| ba|ees|i i|taa|uuf|uf |ada|iin|i f|rra|ani|a w|i w| ad|da |nya|a u|irr|na |hun|isu|hin| ma| ho|ess|und|i m|i b|bar|is |een|ana|mu |bu |i d| sa|f m|add|sa |eeg| ir|i h|n h|u a|aad| la|al |ala|udh|ira|hoj|kee|goo| ya|ook|abu|gac|mum|as |itt|nda|see|n t|n i|uum|n k|ra |rgo|ara|a q|ums|muu|mat|a d|nii|sii|ssa|ati|a g|asu|biy|yya|eef|haw| da| mo|tum|a t|u h|gar|uma|a s|n a|n b|baa|awa|nis|eny|u y|roo|mmo|gam|sat|abs|n m|tee|nna|eer|bir| ku| qo|bil|ili|lis|otu| to|kko|n w|ali|rum|msa|rka| fu|amm|gaa|aaf|era|ya | ye|yer|ero|oti|kun|un |jii|ald|i y|ant|suu|n d|tok|okk|ame|mee|nni|tan| am|lii|n u|aru|lee|gum|ddu|i g|u m|oji|ura|lda|lab|ila|laa|aal|n y|ef |chi|uud| qi|qix|dar|ark|dda|gal|u b| ji|jir|han|art|arb|asa|ega|tam|hii|ffa| se| bu|faa|ndi|n g|bat|oka|kar| mu|mur|aja|uun|naa|sad|a l|lam|ken|enn|u f|egu","swh":"a k|wa |na | ya| ku|ya | na| wa|a m| ha|i y|a h|a n|ana|ki |aki|kwa| kw|hak| ka| ma|la |a w|tu |li |a u|ni |i k|a a|ila| ki|ali|a y|ati|za |ifa|ili| mt|ke | an|kil|kat|mtu|ake|ote|te |ma |ika|ka |we |a s|yo |i n|fa |ata|e k|ama|zi |u a|amb|ia |kut|ina|u w|azi| yo|i z|asi| za|o y|au |yak|uhu|ish|tik|ha |wat| au|u k|e a|mba|hur| bi|ara|sha|uru|mu | as| hi|u n|hi |ru |tai|aif|a b|hal|ayo|cha| uh|i h|yot| ch|awa|chi|atu|e n| zi|u y|ngi|mat|shi|ani|e y|sa |eri|ja |uli| am|ele|i a|end|o k| sh|ima|ami|oja|a t| ta| nc|nch|any|a j|ham|wan|ada|uta|i w|iki|ra |moj|ii |ari|kuw|uwa|ye | la| wo|o h| sa|ti |wak|she|iwe|kan|nay|eza|iri|iwa|fan|bu |i m|uto|lim|ao |her|ria|wen|kam|di | ja|jam| ni|ing|a l|wot|bin|amu|dha|o w|ahi|kaz|zo |da |adh|si | hu|ri |bil|e m|aka|e w|ang|ini|agu|sta|a z|kup|kul|lin|ind|ne |aji|zim|nya|kus|har|nye|asa|nad|dam|rik|iyo| ba|bar| nd|nde|ita|ta |gin|ine|uu |mwe|maa|ndi|kuf|o n|u h|i s|uzi|nga| ye|tah|sil|imu| ut|azo|esh|uni|taa|aar|rif|hii|wez|uba|wam|ush|mbo|bo |ibu|lez|wal|saw|kos|e b|a c| si|aza|tok|oka|tak|eng|dhi|ala|hir|yan|izo|ten|guz| mw|liw|ndo|oa |laz|aha|uku|ian|eli|mam|ua |ndw|zin|aba|pat|del|i b|ufu|nda|a i|mai|ais| um|man|ba |u m|kuh|zwa|sia|tan|taw|e i","sun":"an |na |eun| ka|ng | sa|ana|ang| di| ha|ak |nga|hak|un |ung|keu| ba|anu| an|nu |a b| bo| je|a h|ata|asa|jeu|ina| ng|ara|nan|gan|sa |a k|awa|ah | na|n k|kan|aha|ga |a s|a p|ban| ma|a n|bog|oga|ing|sar| ku| pa|man|a a|ha |san|bae|ae |din|g s|sah|tan|aga|ra | si|ala|kat|n s| pe|ma | ti|per|aya|sin| te| pi| at|n a|aan|pan|lah|gar|n n|u d|ta |eu |kum|ari|ngs|ran|a d|n d|n b|gsa|a m|wa |ama|ku |ike|taw|n p|k h|al | ja|eba|bas|a t|at |ika|beb|asi|atu|pik|kab|una|nda|a j|e b|n h|nag|oh |aba|en |ila|g k|boh|aku|ngg|art|rta|abe|ar |ima|n j|um |di |usa|udu|geu|k a|adi|ola|sak|aca|u s|rim| ay|car|h k|aka|eh |teu|tin| me| po|ti |awe|ngt|sac|jen|u a|uma|ent|k n|gaw|law|dan|uku|ur |teh|h s|bar|aru|ate| hu|nar|n t|jal|aja|dil|ere|iba|ieu|pol|nya|ut |wan|are|mas|ake|upa|pa |yan|huk| so|nus|ngk| du|ura|tun|ya |mpa|isa|lan| ge| mi|u m|kal|uan|ern|tut|tay|h b|hna|kaw|kud|us |und|ena|n m|han|nte|lak| ie|ula|ka | ke|rup| tu|u k| nu|g n|umn|mna|h p|g d|u n|gta|ayu|yun|mba|gam| be|du | ta| wa|wat|eus|a u|ren|umu|i m|ri |eri|rik|u p|dit|ali|h a|k k|k d|ngu|rua|ua | da|amp|men|sal|nge| ra|sas|nas|ona| bi|ame|sab|alm|lma|ami|min|il |kas|ter|mum|rak|mer|ksa|k j|yat|wil|mar|eur|g b|war|gal|kaa|we |tur|e a|r k","ron":" de|și | și|re | în|are|te |de |ea |ul |rep|le |dre|ept|e d| dr|ie |e a|ate|în |tul|ptu| sa| pr|e p|or | pe|la |e s|ori| la| co|lor| or|ii |rea|ce |tat|au | a |ați| ca|ent|ale| fi|ă a| ar|a s|ice|per|ers|uri| li|a d|al |ric| re|e c|e o|nă |i s|ei |tur|men|con| să|lib|ibe|ber|să |rso|tăț|ilo| ac|sau|pri|ăți|i a|i l|l l|car| in|ter|ție|lă |că |tea|a p|ții|soa|oan|ri |nal|in | al|e ș|i î|ril|ană|pre|ui |uni|e f|se |ile|ere|i d|ita| un|ert|e î|a o|ia |i c|fie|ele|ace|i ș|nte|tă |pen|ntr| se|a l|pro| că|ire|ală|eni|est| ni|ă d|lui|a c| cu|n c| nu|ona|sal| as|eri|naț|ând|ră | om| su|ecu|i p|rin|e n|ici|i n|nu |oat|inț|ni |tre| to|tor|ări|soc|oci|ste| na|iun| di| po|l d|va |ega|gal| tr|ă p|ulu|n m|ă î|a a|rec|res|i o| so|fi |sta|sa |uie| au|lit| ce| mo|din|ces|nic|int|nd |i e|cla|ara|ons| îm| eg|a î|rel|e l|ial|i f| fa|ță |leg|e e|tar|ra |ă f|a f|rar|iei|nit|ă c|tru|ru |u d|act|at |rtă|ți |nta|nde|eme|ntu|ame|reb|ebu|bui|toa|l c| o |ion|ă ș|dep|ali|ât |ili|ect|ite|i i|pli|n a|dec|rta|cu |împ|cți|ane|e r|văț|nt |u c|ța |l ș|cia|țio|ită|bil|r ș|poa|ca | st|t î|tri|riv|man|ne |omu|rie|rit|înv|nvă|ăță|mân|mod|od |rot| ma|cur|u a|oar|uma|a ș|rii|era| ex|tra|iil|ani|țiu|lic|t s|nța|eze|ta | va","hau":"da | da|in |a k|ya |an |a d|a a| ya| ko| wa| a |sa |na | ha|a s|ta |kin|wan|wa | ta| ba|a y|a h|n d|n a|iya|ko |a t|ar |ma | na|yan| sa|ba |asa| za| ma|hak|a w| ka|ata|ama|akk|i d|a m| mu|su |owa|a z|iki| ƙa|nci|a b| ci|ai | sh|kow|anc|nsa|a ƙ|a c| su|shi|ka | ku| ga|ne |ani|ci |e d|kum|uma|‘ya|cik| du|uwa|ana| ‘y|i k|ali|ɗan| yi|ada|ƙas|aka|kki|utu|n y|hi |a n| ad| do| ra|mut|tar| ɗa| ab|nda|a g|man|nan|ars|cin|ane|and|n k|min|yi |i a|ke |sam|ins|a i|nin|yin|ki |tum|ni |aɗa|ann|e m|ami|dam|za |en |kan|um |yar|mi |duk|oka|n h| ja|dai|kam|ewa|mat|i y|nna|abi|ash|n s|waɗ|ida|am |re |ga |sar|kok|oki|una|mas|ra |i b|dun|uni|abu|a ‘| ƙu|n j|awa|ce |a r|e s|ara|a ɗ|san|li |aba|cew|she|ƙun|kar|ari|m n|niy| ai|aik|u d|kko|buw|n w| la| ne|rsa|zam|omi|rin|hal|bub|ubu|aya|a l|han|ban|o n|are|add|i m|zai| hu|me |bin|tsa|sas|i s|ake|n ‘| fa|kiy|n m|ans|dom| ce|r d|uns|ƙar| an|jam|ɗin|i w| am|n t|wat|ika|yya|nce|har|ame|gan|hen|n b|n ƙ|dok|fa | ki|yak|ray|abb|din|on |bay|aid|ayi|aci|dan|aur|ili|u k| al|rsu| ts|ukk|kka|aye|nsu|ayu|bba| id|ant|n r|o d|sun|tun|unc|sha| lo|lok|kac|aif|fi |gam|aga|un |lin|aɗi|yuw|aja|fan|i i|ace|uka|n i|war|riy|imi|sak| ir|yay|tab|bat|mar| iy|sab|nta|afi|o a| ak|bi ","fuv":"de | e |e n|nde| ha|la |e e|akk| ka| nd|ina| wa|al |hak|na | in|ndi|ɗo |kke|ii |di |aad|ade|um |ko |i h|ala| mu| ne|lla|ji |wal| jo|mum| fo|all|neɗ|eɗɗ| le| ko|e h|kal|taa|re |aaw| ng|e k|aa |e w|ee |ley|jog|ke |e m|laa|nnd|eed|e l|ɗɗo|aag|ol | ta|o k|kee|gu |ti |dee|a j|ogi|waa|m e|am |le |eji|ond|nga|gal| wo|ɓe |ɗe |e d|awa|gii|ede|eej| re|gol|aan| go|agu|i e|oti|ann|fot|eyd|e t|ɗee|naa|oto|ydi| po|pot|maa| he|een|i n|enn|ni |taw|a i|e j|e f|a k|goo|to |dim|der|ele| aa|o n| de| fa| ba|ngu|oot|er |dir|won|oor| sa|ngo|ka |ndo|i k|a n|ay |ota|a f|ima|e ɓ| to|i f|a e|tee|ren| ja|i w|wa |o f|fof|ore|eyɗ|yɗe|a w|too|ma |o t|awi|i m|kam|o e|hay|and|nan|ñaa|e y|of |eel|e s|hee|aak|nka| do|l e|e g|ira| la| so| ɓe|a t|dii|e i| te|tin|e r|e p|o w|ani|aar|are| na|ral| ña| yi|awo| ya|so |aam|i l| ho|oo |ooj|nng|nge|woo| ma|faw|kaa| mo|u m|und|dow|gaa|en |o i| li|lig|igg|e a|ita|e b| o | nj| mb|o h|nda|ude|ɗi | no|haa|a h| fe| di|iin|iti|tii|yan| tu|tuu|inn|ama|baa|iiɗ|den|tal|aaɗ|yim|imɓ|njo|edd|ine|nee| je|jey|lli|lit|uug|ugn|no |bel|go | hu|ank|je |do |guu| da|mii| ke|a d|ano|non|l n|y g| ɗu|gna|mɓe|ete|i a|wit|jaŋ|aŋd|ŋde| su|alt| ɗe|nna|a a| ɓa|ɓam|amt|tde|ago|l h|m t|ind|ɗɗa|aga|eɗe|ow ","bos":" pr| i |je |rav| na|pra|na |da |ma |ima| sv|a s|nje|a p| da| po|anj|a i|vo |ko |ja |va | u |ako|o i|no | za|ju |e s| im|avo|ti |sva|ava|o n|i p|li |ili|i s|ost|van|vak| ko|ih |ne |a u| sl|nja|jed| ne| dr|koj|ije|i d| bi|stv|im |u s| il|slo|lob|obo|bod| je| ra|pri|sti|vje| ob|a d|om |se | su|e i|a n| se|i i|dru|enj| os|a b|e p|voj|cij|u p|o d|a o|raz|su |i n|uje|ova|u i|edn| nj| od|i u|u o|lo |ran|lju|ni |jen|ovo|aci|iti|o p|a k|oje|žav|nos|dje|e o|bra|pre|a j|pro|ji |i o| ka|nih|bit|jeg| tr|tre|bud|u z|og |sta|drž|rža|e d|u n|pos|mij|elj|svo|reb| bu|avn|jem|ija|e b|ći |aro|rod|red|ba |a z|šti|ka |de |em |aju|iva|lje|ve |e u|jel|jer|bil|ilo| iz|eni|du | do| st|a t|za |tu |nar|tva|odn|gov| sa|nim|m i|e n|vim| ni|u d|o k|oji| sm|dna|ući|ist|i m|eba|ičn|vno| dj|oda|nak|e k|an |nov|sno|stu|aln|nst|eno|eđu|čno|ani|nom|olj|tiv|nac|ave|i b|smi|čov|ovj|osn|a r|nap|ovi|ans|dno|jan|nju|oja|nog|m s|edi|ara|oj |nu |kri| kr|odu|iko|lja|sto|rad|nik|tup| čo|jek|tvo| vj| mi|tel|obr|živ|tit|una|ego|pod|sam|o o|rug| op|nji|din| mo|vu | ov|h p|udu|riv|dst|te | te|a č|vni|svi|i v|ina|i t|ite|o s|u u|m n|zaš|ašt|itu|ak |dni|nic|nič|odr|vol|avi|g p| ta|rim|kla|e t|ao | vr|akv|tno|mje|duć|ona|ada|obi|eds","hrv":" pr| i |je |rav|pra|ma | na|ima| sv|na |ti |a p|nje| po|a s|anj|a i|vo |ko |da |vat|va |no |o i| za|ja |i s|avo| im|sva| u |i p|e s| bi|tko|ju |o n|li |ili|van|ava| sl|ih |ije| dr|ne |ost|jed| ne|u s|ova|nja| os| da| ra| ko|slo|lob|obo|bod|atk|i d|koj|iti| il|stv|pri|im |om | ob| je| su|vje|i u|i n|e i|i i| ka|bit|dru|ati|se |voj|i o|a b|a o|ćen|ući|a n| se|o p|enj|edn|a u|sti| mo|ćav|lo |dje|raz| od|ran|u p|rod|a k|ni |su |mij|u i|svo|ako|a j|aro|drć|rća|pos|eno|e p|pre| nj|e o|ćiv|nar|ji |oje|e n|eni|nih|oda|ći |nov|bra|ra |nim|a d|avn|og |aju|iva|ovo|nos|i b|bil|sno|za |ovi|red|tva|a z|mor|ora|ka |sta|jem|pro|jen|u o|cij|ve |e d|jel|jer|ilo| do|osn|i m|odn| iz|nom|lju|em |lje| ni|aci|oji|o d|du | st|nit|elj|u z|jeg| sa|o o|m i|vno|vim|uje|e b|oj | dj|rad| sm|dna|nak|e k|an |stu|o s|tit|tu |aln|nst|eću|dno|gov|ani|juć|u d|m s|e u|a ć|u u|nju| bu|bud|te |ćov|ovj|tvo|a r|nap|šti|ist|ću |ans|m p|jan|nić|olj|u n|edi|ara|nu |o k|udu|ona|smi|odu|ada|oja|tup| ćo|jek| vj|ina| mi|tel|i v|obr|zaš|ašt|una|dni|ija|pod|sam|duć|rug| op| ta|nji|e m|oso|sob|h p|itk|svi|ite|elo|itu|meć|jim|odr|di |vol|avi|nog|štv|rim|din|kla|će |ao |tno| ći|kak|akv|ave|nac|lja|sto|obi| te|to |vi |ovn|vni|odi|lji","nld":"en |de |an | de|van| va| en| he|ing|cht|der|ng |n d|n v|et |een|ech| ge|n e|ver|rec|nde| ee| re| be|ede|er |e v|gen|het|den| te|ten| op| in|n i| ve|lij| zi|zij|ere|eli|ijk|oor|ht |te |ens|n o|and|t o|ied|ijn| on|ke |op |eid| vo|jn |id |ond|in |sch| vr|n z|rde|aan| ie|aar|ren|men|rij|hei|ord|hte|eft| we|ft |n g|n w|or |n h|eef| me|wor|vri|t r|hee|al |le |of |ati| of|g v|lle|e b| wo|eni| aa|voo|r h|n a| al|nd |e o|n t|ege|erk|t h|jke| na|sta|at | da|e e|end|nat| st|nge|ste|e g|tie|n b|om |die|e r|r d|erw|ij |dig|e s| om|wel|t e|ige|ter|gel|ie |e m|re |t d| za|ers|ijh|jhe|d v|zal|nig|nie|bes|ns |e w|est|d e|g e|e n|ele| do|ge |vol|che|e d|ig |gin|eze|nst|ona|eke|cha|hap|dat|lke|e a| di|waa| to|min|jk |tel| gr|len|eme|lin|elk|ard|doo| wa|eve|ven|n s|str|gro|han|del|ich| ov|ove|n n|t v|tio|ion|wet|it |gem|ijd|met| zo|uit|aat|dez|ze |rin|e i|all|st |ach| ni|toe|n m|ies|es |taa|per|hed|heb|ebb|bbe|ien|sti| ma|nte|ale|kin|nin|mee|daa|el |ben|ema|man|s e|e h|esc|her|lan|ang|ete|g o|wer|is | er|pen|nsc|beg|igd|t g|ont|iet|tig|ron|tin|p v|r e|rwi|wij|ijs| hu|erm|nal|bij|eer|edi|ite|t a|t w|d o|naa|weg|iem|g d|teg|ert|arb|als|d z|tan|tre| la|ar |ame|js |rmi|t b|app|rwe| bi|t z|ker|eri|ken| an","srp":" pr| i |rav|pra| na|na | sv|ma | po|je |da |ima|a p|ja |a i|vo |nje|ko |va |anj|ti |i p|ako| u |a s| da|avo|ju |i s|ost| za|o i|sva| im|vak|o n|e s|ava|nja| sl| ko|om |no | ne|ne |li |u s| dr|ili|a n|slo|obo|koj|ih |lob|bod|im |sti|stv|a o| il| bi|pri|a u| ra| je|og |jed|enj|e p|u p|van|ni |a d|i u|edn|iti|nos|a k|o d|ova|pro| su|i i| os|ran|sta|dru|e i|cij|se |rod| ob|i o|aju|e o|i n|ove| de|aci| ka|ovo| ni| od|ve | se|i d| st|m i|voj|avn|uje|eni|ija|dna|žav|u i|red|su |nov|odi|tva|e b|oja|što|lju|u o|ara|a b|ji |drž|rža|odn|jan|nim|poš|ošt|a j|ka |jen| ov|u u| nj|du |ave|osn|sno|šti|aro|raz|bit|a z|u z|de | iz|nih|o p|u d|e d|pre|vu |u n|lja| tr|tu |eđu|nar|gov|svo|bez|ičn|lje|e n|za |vno|lo |oji| sa|to |an |nak| me|čno|đen|vim|nac|oda|ani|me |iko|nik|ika|e k|pos| kr|tre|reb|nst|stu|e u|ku | do|ašt|tit|aln|dno|jeg|nom|olj|nog|m s| vr|o k|oj |čov|ans|ovi|o s|bra|te |tav|tup|eno|živ|zaš|em |i m|dni|šen|var|riv|rug|vol|avi|tan|štv|kao|ao | li|st |ilo|nju|sme|o j| sm| čo|odu|vre|dst|od |a t|kri| bu|bud| ve|ver|a r|m n|del|tvo|međ|oje|jem|m p|avl|vlj|ego|u v|pod|ena|ugi|la |jav|por| op|ruš|ušt|kom|edi|ba |kla| mo|oju|i b|kak|akv|rad|nu |vek|rim|gla|juć|ude|vni|eba|e r|svi|i v|itu|ter","ckb":" he| û |ên | bi| ma|in | di|na |maf|an | ku|ku | de| ji|xwe|her|iya| xw|ya |kes|kir|rin|iri| ne|ji |bi |yên|afê|e b|de |tin|ke |iyê|e h|es |ye | we|er |di |we |i b|ê d|erk| na|î û| an|ina| be|yê |eye|rke|î y|nê |kî |diy|ete|hey|hem| ci|eke| li|wek|ber|fê |n d|li | bê| se|yî | te|ne |rî |sti|net|tew|yek|af |hev|yan|n b|kar| ki|re |e k|wî |i h| ew|n û|û b|aza|n k| wî| mi|î b|dan|e d|î a|ekî|a m| az|zad|mir|iro|rov|nav|n h|ser|est|a w|ara|bin|ewe|anê|adi|tê |be |emû|mû | yê| ya|ta |ast|tî |ev |ewl|s m|n m|wey| tu|wle| bo|bo | tê|n j| me|ê h|din|ras|î d|n n| da|n w|bat|wed|ema|ê b|cih|st | ge|iye|ing|ar |în |r k| ke| pê|îna|î h|ekh|khe|vî |ana|par|û m|ûna|civ|vak|n e|dî |nge|geh| ye|ê t|ê k|û a|fên|hî |e û|av |eyî|bûn|erb|î m|bik|ê m|a x|iva| re|e n|eyê|vê |ane|man|nên|ela|end| pa|erî|n x| ta|jî |ika|kê |a k|f û|f h|e j|î n|ra |ehî|tiy|tên|û h|a s|rbe|bes|mî |ari|eza| ni|nek|n a|ov |i n|erw|rwe|erd|aye|e e|riy| a |ike|ê x|ovî|û d|inê|etê|tem|yet|eta|ek |ê j|a n|e t|i d|zan|bê |anî|nîn| ra|ama|ere| hi|i a|tuk|uke|bib|lat|awa|u d|ibe|xeb|atê|i m|mal|nda|ewa|a d|a b|arî| ba|edi| hî|hîn|rti| za|ist|e m| wi|mam| şe| qa|qan|anû|nûn|asî|han| ên|a g|u h|tu |dew|let|are|ine|pêş|êr |e a|wel|ger","yor":"ti | ní|ó̩ | è̩|ní | lá|̩n |o̩n|é̩ |wo̩|àn | e̩|kan|an |tó̩| tí|tí | kò|ò̩ | àw|̩tó|è̩ | àt|è̩t|bí |e̩n|àti|lát|áti| gb|lè̩| ló| ó |s̩e|àwo|gbo|̩nì|n l| a | tó|í è|ra | s̩|n t|ò̩k|tó |sí |kò̩|̩ka|o̩ | sí|ìyà|orí|ílè|ì k|̩‐è|dè |yàn|ni |̩ à|ún | or|èdè|jé̩|ríl|è̩‐|‐èd|í à|àbí|n à|nì |ò̩ò|̩ò̩|í ó| tà|tàb| ti|̩ t|jo̩|̩ l|̩e | wo|í ì|nìy|ó n| jé|ló | sì|kò |n è|wó̩|n n| bá|̩ s|rè̩|sì | fú|fún|í a| pé|̩ni| òm| kí|gbà| èn|ènì|pé |in |ba |òmì|nir|ira|ìí |ràn| ìg|ìgb|n o|bá |mìn|ìni|gba|kí |n e| rè|e̩ |̩ n|un |̩ p| o̩|í ò|nín|nú |fi |gbé|yé | ka|ínú|a k|bé̩|mo̩| fi|̩ ì|í i|ó s|i l|wà |o̩d|̩dò|dò̩|̩ o|bò |dá |i ì|bo̩|hun|i ò|o̩m|̩mo|̩ k|áà |̩wó|bo |àgb|ló̩| ò̩|ó j| bí| oh|ohu|í k|n s|írà|bà |ara| ìb|ogb|pò̩|ú ì|yìí|rú |kó̩|ó̩n|i t|̩ ò| lè|lè |̩ e|à t|à l|bog|a w|gé̩| yó|yóò|óò |ò l|̩gb|ò̩r|̩ y|í w|̩ f|í t| wà|ó̩w|yí |ó b|̩ a|ìké|i n|i è|láà|àbò|fin|wùj|ùjo|n k|í e|é̩n| òf|òfi| mì|mìí|ìír|jú |rin|̩é̩|i j|ó t| ar| ir| ná|náà| ìk|̩ b|i s|ú à| yì|kàn|irú|rí | i |è̩k|̩kó|fé̩|é à|i o|s̩é|̩ m| ìd|è̩d|̩dá|i à|àwù|à n|ú è|wù | èt|áyé|í g|í o| mú|a l|láb|ábé|̩è̩|ìn | kú|láì| àà|i g|bé |níp|ípa| ìm|níg|ígb|wò̩|báy|ké̩|mú |í n|de |è̩s|mó̩| dá|i a|dó̩|ó̩g| ni|i p| wó|ayé|ùn |̩ w|a n|n f|n ì|je̩|ò t|n g","uzn":"lar|ish|an |ga |ar | va| bi|da |va |ir | hu|iga|sh |uqu|bir|shi|huq|quq|gan| ha| bo|ini|ng |a e|r b|ni | ta|lis|lik|ing|ida|oʻl|ili|ari|nin|on | in|ins|adi|nso|son|iy | oʻ|lan| ma|har|dir|hi |kin|ash|i b|boʻ| yo| mu|uqi|dan|ila|qig|ega|r i|qla|oʻz| eg|a b| er|erk|kla|qil|oli|ki |gad| ol|nli|lga|at |i h|a o|rki|oki|osh|lig|igi| qa|yok|ib |las|n m| ba| qi|n b|ara|atl|ri |iya| sh|ham|ala|lat|bil|in |r h|bos|a t|siy|a y|cha|n o|a h|ik |a s|inl|a q|yat|nis| et|eti|osi|h h|i v|ani|tla|til|mas|ʻli|asi|ati| qo|i m|ris|im |a i|uql|arn|rni|qar|ha |gi | da|sha|n h|i o|rch|mla|li |i t| xa|arc|bar|ʻz |hun|a a|rla| bu|a m|lin|lib|taʼ| tu| as|h v|tib|aro|un |tga|r v|ikl| be|mum|n q|ali| te|sid| to|mat|amd|mda|tas| ke|shu|lla|shg|hga|n e| ya|dam|aml|oya|xal|hla|ola|iri|irl|ill|rga|iro|tis| de|umk|mki| eʼ|ten|eng|rda| is| sa|gin|imo|tar|ush|ur |ayo|rak| so|alq| ki|aza|k b|oda|oʻr|a k|tni|ʻlg|n v|hda|nda|shq|hqa|zar|miy|i q| mi|mil|r t| si|ak |ada|rat|or |kat|era|siz|am |ch |aso|sos|yot|atn|shl|n t|nid|y t|ana|ti |rin|asl|bu |sin|dav|ilg|as |i y|ech|nga|lak|h k|ino|ʼti|gʻi|muh|a v|bor|uch|lim|a u|uni|lli|n i|uri|si |i e| ka| ch|a d| ja|ami|qon|na |rig|lma|ker|avl|vla|i a|dek|ekl|liy|aka| em|ema|eʼt","zlm":"an |ang| ke| se|ng | da|ada|dan|ara| pe|ak | be|ran|ber| me|ah |nya|hak|per|n s|ata|ala|ya |a s|kan|asa|lah|n k| di|da |aan|gan|nga|dal|erh| ma|n d|eba|rha|a p| ha|kep|pad|yan|ap |ama| ba| ya|nda| te|ra |a b|tia|man|eng|a d|ora|men|iap|n p|ter|epa|san| or|eti|pen| ad| at|n a|a a|h b|set|tan|sia|tau|n t|n b|ta |dak| sa|sa |at |au |ela|apa|pa |beb|bas|p o|h d|n m|keb|end|aka|ega|a k|am |sam|ana|gar|k k|ban|ole|leh|neg| un|lam|di |g a|eh |n y|aha|han|a m|eri|any|ma | ti|a t|uan|mas|ngs|atu|seb|ebe|ing|ian|car|bag| ne|mem|kes|mat|gsa|ia |ika|i d|nan|asi|und| la|epe|ert|agi|emb|na |ers| de|emu|pem|ngg|anu|i m|ind|erk|ung|n h|tu |gi |kla|g b|pun|iha| in|nus|usi|tin|al |si |as |akl|dap|erl|era|sec|eca|i s|lan|bar|k m|ena|aya| as|sas|nny|rta|sem|awa| su|bol|rat|den|ini|ni | ta| he|hen| an|tar|g m|ai |kem|adi|had|in |ti |i k| bo|uka| ap|g t|ka |ann|ema|g s|ain|k h|rka|ri |n i|aga|un |ses|dun|enu|emp|elu|lai|kat|ent|nta|rsa|iad|ua |dia|ira|a n|mpu|ntu|uk |mel|k d|har|ker|dil|mar|h m|aja|ila|k a|mba|lua|i a|rak|uat|jua|rma| pu|t d|rga|i p|uma|ser|esi|ar |esa|nak|bah|rli|lin|ndu|dar|ari|ese|l d|ant|ngk| ol|sua|g d|ati|tuk|erm|saa|erj|rja|kea|raa|gam|g u|tik|ida|sek|eka|sat|i b|mbe|unt|dir|iri","ibo":"a n|e n|ke | na|na | ọ | bụ|nwe| n |ere|ọ b|re |nye| nk|ya |la | nw| ik| ma|ye |e ọ|ike|a o|nke|ụ n|a m| ya|a ọ|ma |bụl|ụla|e i| on| a |iki|kik|ka |ony|ta |bụ |kwa|i n|a i| nd|di |a a|wa |wer|do | mm|dụ |e a|any|ha | ga| ok|e m| ob|he |ndi|e o|a e|ite|ọ n|rụ |hi |ga‐|mma|wu | dị|aka|ara|che|oke|o n|we |n o| ih|mad|adụ|obo|bod|odo|a g|te | ez|hị | ka|ụta|be | an|akw|zi |a‐e|dị | oh|gba|nya|u n|ihe| ak|me |i m|ala|ri | ọz|ghi|ohe|her| mb|ba | nt| si| iw|weg|pụt|ra |iri|chi|ụrụ|rị |zọ |oro|ro |iwu|a‐a|ụ ọ|ụ i| eb|ebe|e ị|a y| in|ezi|kpa|kpe|inw|mba|sit|ịrị|ile|le | ha|e e|bi |n e|chị| en| e |i ọ|asị|mak| ni|nil|ghị|si |ide|a u|o i|i o|i i|apụ|a s|e y|u o|ụ m|ahụ|hụ |a ụ|nkw|edo|n a|ru |ụ o|ozu|enw|ọzọ|kwu|gid|sor|egh|yer|tar|n i|pa |eny|uru|kwe|toz|ị o| mk|ama|de |uso|tu | im|ime| me|i a|ịch|ọ d| ịk|obi| ọn|hed| ọr|ọrụ| to| ch|gas|wet|mkp| kw|osi|a d| nh|nha|ọnọ|nọd| al| nc|nch|sir| o |n u|sịr|eta|u ọ|ị m|n ụ| us|nọ | ot|otu| gb|ọdụ|nwa|o m| ag|ali|lit|ọta|ega|ị n|e k|e s|ji |a k|ikp|ọch| ug|ban|ekọ|pe |nta|agb|na‐|n ọ|hu |i e|e g|a b|zu |chọ|u a|kwụ|ram|esi|uch|onw| nọ|ị k|u m|eme|wan|e h|dịg|ịgh|hịc|ugw|gwu| di|ich|cha| og|okp|kpu| nn|zụz|zụ |i ị|o y|ach| ng|pụr|ị e|a h|meg|nat|uwa","ceb":"sa | sa|ng |ang| ka|an | pa|ga | ma|nga|pag| ng|a p|on |kat|a k|od |ug | ug|g m| an|ana|n s|ay |ata|ung|ngo|a m|atu|ala|san|ag |tun|g s|g k|d s|god|a s|ong| mg|mga|g p|n u|yon|pan|a a|usa|ing|tag|tan|una|mat|ali|aga|g u|han| us|nan|y k|man|ina|non|kin| na|lan|syo|a b|asa|nay|a i|n n| ta|awa|nas|taw| o |nsa|gaw|a n|agp|dun|iya|ban|isa|was| ad|adu| gi|ili|ini|asy|bis|nag|g a|a t|o s| bi|nah|lin| ki|al |sam|lay|ahi|nal| ba|ano| wa|wal|asu|agt| di|yan|ama|a u|n a|ags| iy|gan|n k|kan|him|kag|ya | un|gpa|kas|aha| su|g t|awh|wha|gsa|l n|agk|gka|a g|gla|kal|gal|ran|sud|ud |imo|d u|aba|aka|ika|ig |ngl|ipo|g d|ara|g n|uka|uns|uta|d n|og |i s|y s|kau|li |n o|aki|o p|kab| og|ot |mta|gik| si|n m|gpi| la|g i|aho|ayo|iin|ok |awo|hat|o a|gon|ip |a w|apa|lip|na |a h|bal|la |ad | ga| ti| hu|uba|wo |ati|uga|hon|hin|ma |sal| ub|agb|gba|nin| bu|buh|uha|t n|ahu|may|pin|as |ni |mak|ihi|abu|uma| in|say|d a| pi|dil| ni|ins| pu|agh|at |hun|but|aug|lak|bah|sak|o u|mal|s s|os |amt|t s|pod|sos|ngp|lam|aod|ila|a d|ami|k s|tin|ura|mo |agi|tra| at|bat|aan|ulo|iha|ha |n p|kar|oon|sya|ona|aya|in |inu| hi|it |agl|amb|mbo|mag|a l|ho |lao| al| il|iko|ngb|mah|lih|g b|gta|gtu|y p|rab|ato|tar|nab| re| so|osy|yal|aw |gda","tgl":"ng |ang| pa|an |sa | sa|at | ka| ng| ma|ala|g p|apa| na|ata|pag|pan| at| an|ay |ara|ga |a p|tan|g m| mg|mga|n n|pat| ba|aya|n a|na |ama|g k|kar|awa|a k|lan|rap|gka|nga|n s|g n|g b|a a|aha| ta|agk|gan|asa|tao|aka|yan|ao |a m|may|man|kal|ing|nan|a s| la|aga|ban|ali|g a|ana|y m|kat|san|kan|pam|g i|ong|mag|a n|baw|o a|wat| y |isa|lay|y k|t t|ila|g s|in |kas|o y|aan| ay|ina|t n|t p|wal|ag |una|yon| it| o |nag|tay|pin|ili|ans|lal|ito|any|nsa|kak|a i|lah|mam|nta|nya|gal|hay|to |ant|aba|ran|agt|on |han|agp|kap| ga|t s| wa|gaw|o m|ya |as |g t|lip|y n|hat|g l|ung|ngk|no |gpa|lag|gta|t m|wa |yaa|ari|sal|a l|kai|pap|lin| pi|ita|ahi| is| di|agi|ipi|bat|mak|pun|a b|y s|aki|tat|la |hin|pah|yag|gay|o n|ags|iti|di |i n|sas| si|t a|al |a t|ika|mal|s n|ipu|t k|ais|hal|i a|sap|lit|od |ihi|alo|y p|ani|ig |par|ap | ip|tas|gin|gga|nin|uma|gsa|ano|ira|a g|nah|uka|syo| bu|ini|o s|nap|ngi|o p| ha|a h|mah|a o|li |ipa|uha|asy|lam|iba|aru|mba|g e|usa|lim|sam|pil| da|kin|duk|sin|dai|aig|igd|gdi|dig| tu|d n|ba |nas|pak|iga|kil|n o|nak|ad |lig|git|lab|ma |kab|nar|tag| ed|edu|aho|buh|and|nda|mas|pas| ib|it |ri |lun|ula|agb|g g|ain|pul|ino|gi |sar|g w|abu|s a|api|nil|iyo|siy|iya|anl|uli|aun|agg|amb|g d|ati| li|i m","hun":" sz| a |en | va|és | és|min|ek | mi| jo|jog|ind|an |nek|sze|ság| az|gy |nde|ala|sza|den|az |a v|val|ele| el|mél|oga|egy|n a| eg|ga |zem|zab| me|emé|van|int|tel|aba|bad|tet|ak | te|tás| ne|gye|t a|ény|ély|tt |n s|ben|zet|ség|lam|meg|nak|ni |ete| se|lyn|yne|s a| al|let|z e|ra |et |agy|sen|eté|k j|tek|mel|kin|ok | ki|ez |hoz|oz |n m|re |vag|ett|emb|mbe|es | kö| le|nem|ell|em |ely|hog|ogy|s s|gok|atá|k a|nt |köz| ho|z a|hez|el |len|yen|ásá|ads|dsá|tés| em|a m|a s|nte| ál|k m|ás |a t|szt|áll|a h|y a|ogo|sem|ber|ban|enk|nki|nye|lap|t s|ese|ame|nyi|k é|ágo|ló |ág |t m|on | vé|i m|ami|ébe|s e|lat|lla|ly |mén|fel|tat|eri|lő |a n|eki|n v|yes|emz|mze|lle|a a| cs|át |kül|elő|l a|nd | ke|ég |i é|lis|vet|éte|ért|rés|yil|ésé|enl|szo| am|tar|art|alá|elé|a j| ny|koz|het|ész|ja |lem|nlő|ri |i j|s é|éle|ól |aló|kel| ha|ges|zás|más|s t|tár|s k|t é|vel|tko|zés|ése|se |tő |ot |ott|sít| fe|n k|lek|tte|olg|áza|ssá|e a|eve|szá|ti |n e|ül |zte|ána|zto|tos|árs|os |k k|eze|leh|ehe|t n|tes|kor|atk|del|t k|tot|ány|ége|fej|i v| né|ház|leg|k e|ll |nev|is |ába|t t|véd|éde|d a|zer|ere|kif|ife|téb|ny |ai | bi|biz|izt|i e|sül|lt |zat|at |elm| ar|arr|rra|sel|t e|ágá|s n|csa| mu|nél|it |esz| há|zas|ass|üle| ta|nyo|alk","azj":" və|və |ər |lar| hə|in |ir | ol| hü|hüq|üqu| bi|quq|na |lər|də |hər| şə|bir|an |lik| tə|r b|mal|lma|ası|ini|r h|ən |şəx|əxs|qla|arı|a m|dir|ali|aq |uqu| ma|ilə|ın |una|yət| ya|ara|ikd|ar |əri|əsi|r ş|rin|əti|dən|nin|n h| az|yyə|sin| mü|tin|ni |zad|iyy| mə|ərə|mək|ün |nda|ət |i v|ını|nın|ndə|ə a|aza|rın|qun|olu| et| qa|lıq|ilm|kdi|lə |ə y|ək |lmə|ına|ind|olm|xs |mas|sın|lun| in|ə b|da |n t|əmi| bə|adl|dlı|n m|nə |q v|ya |tmə|bər| on|ə h|əya|sı |nun|etm|dan|inə|maq|un |raq|ə v| va|n a|n b|rlə|ə m|si |əra|n i|ınd| öz|anı|nma|ama|rı |ığı|li |il | al|ala| di|ə d|ik |irl|ins|lət|a b|bil|ıq |müd| sə|ə i|nı |nla|ələ|dil|alı|ə e|unm|n v|ola|asi|üda|ili| də|nsa|san|uql|ə o|xsi| he|uq |ətl|həm|əni|eyn|u v| da|tər|min|yin|kil|dır| bu|lan|iş | ha|məs| ki|mi |lığ|ə q|q h|i s|daf|afi|fiə|r v| iş| əs|sos|osi|sia|xal|alq| ta| as| ed|bu |heç|eç |rə |yan|ı h|kim|iyi|ı o|ina|siy|əsa|sas|a q|yar|lı |tün| is|ist| so|al |n ə|ifa|əmə|ə t|mil|ill|lıd|ıdı|ır |ədə|ıql|liy|tlə|a h|məz| bü|büt|ütü|iya|iə | üç|üçü|çün|t v|dax|axi|xil|r a|ılı|man|sil| se|seç|adə|ial|onu|öz | cə|miy|əyi|n e|edi| mi| nə|a v|mən|ril|əz |ild|rab|abə|şər|ğın|aya|zam| ni|ulm| xa|təh|əhs|hsi|i h|sti|qu |var|ad |tam|uğu|z h|qan|rəf|n d","ces":" pr| a |ní | ne|prá|ráv|ost| sv| po|na |ho |ch | na|nos|o n|ání| ro|ti |vo |neb|má |ávo| má|ou | ka|kaž|ažd|ebo|bo | je| za|ždý|dý | př|svo|a s|sti| st|á p| v |vob|obo| sp|bod|pro| zá|rod|ých|ván|ý m|né | by|ení|ého|spo| ná|í a|ová|o p|roz|mi |ně |ter| li|a p|nár|áro| ja|jak|by |to |lid|u p| vš|ny |ím |í p|i a|a z|o v|kte|mu |at |odn| vy| ma| so|ví |zák|tní|a v|oli|li | kt|í n|kla|do |je |pod|en |em |byl|mí |áva|stá| do|t s|rov|í s|tví|vše|it |dní|o s| ve|pol|í b| bý|být|ýt | se|čin| k |sou|a n|stn|ran|vol|nou|ejn|nes|se |ci |nýc|du |ným|stv|žen|své|vé |ají|jeh|eho|va |mez|ním|ích|ým |ké |ečn|pří|u s|tát|i s|kol|ova|e s|ech|í v|ids| i |maj| to|nu |hra|ave|ole|i v|kon|m p|ému|y s|o z|eré| ze|o d| že|chn|ovn|len|dsk|lad|vat|chr| ta|m a| ab|aby|sta|pra|néh|esm|smí| ni|i n|že |ako| os|sob|aké|i p|st |rac|kdo|zem|m n|odu| ji|bez|ste|ákl|ens|ými|í m| vz|i k| oc|och|jí |oci|áln|lní|a m|dy |lně|vou|při|rav|leč| s |t v| či|čen|áv |slu|jin|oko|nez|tej|řís|stu|ské|ský|nit|ivo|a j|věd|iál| me|ezi|ven|oln|zen|í z|y b|zac|níc|ky |u a|a o|u k|inn|est| tr|svě|nik|ikd|í k| mu|u v|kéh|jno|jíc| dů| od|tup|ože|i j|odi|děl|ího|rok|anu|soc|ciá|ve |é v|něn|din| vo| pl|pln|vin|u o|h p|tak|adn|a t|cho|ává","run":"ra |we |wa | mu|e a| n |se |a k|ira|ntu|tu | ku| um|ko |a i|mu |ye |hir|iri|mun|ing|unt|ere|ash|shi|a n|umu|zwa| bi|gu |ege|a a|za |teg|e k|ama|go |aba|uba|ngo| ba|o a| ar|ung|ish|ora|a m|e n| we|sho|na |ese| kw|nga|e m|mwe| ab|ugu|ate|ndi|kwi| gu|ger|riz|wes| at|di |u w|n u|yo |gih|ban|ngi|iza|e b|ara| am|ri |ka |a b|e i|hob|obo| ca|ro |u b|can|nke|ezw|a u| in|bor|bah|ahi|rez|iwe|gir|iki|igi|ihu|ke |ari|ang|aku|a g|hug|ank|ose|u n|o n|rwa| ak|and|kan| vy|ngu|nta| ub|aka|ran| nt|n i|ata|kur|kun|i n|ana| ko|e u|iye| ka|re |any|amw|ta |nye|uko|gin| zi|ite|era|ga |aha| ib| ng|n a|o u|o k| iv|ivy|ho | as|sha|o m|o b| bu|mak|ako|o i| ig|o z|o y| uk|ubu|aga|izw|i b|vyi|ba |aho|kir|nya| is|kub|hin| it|uri|gan|rik| im|u m|guk|bat|nge|kug|ani|vyo|ene|imi|imw| y |jwe|ze |agi|e c|u a|gek|ush|i i|uru|ham|uza|e y|ibi|amb|bur|ina|eme|i a|abi|ha | nk|eye|gus|ber|u g|no |rah|zi |w i|ma |tun|ind|ron|ras|wo |ne |wub| gi|gen|kiz|y i|kor|ura| zu|zub|zin|je |iro|mat|eko|bwa|ika| bo|bak|onk| ma|ugi|mbe|ihe| mw|eka|ukw|wir|ryo| ic|a z| ry|bwo| ag|yiw| ki|gis| yo|bik|ni |nka|rek| bw| ya|tse| ha| ah|umw|he |eng|bir|aro|ury|twa|ant|a c|tar|uki|mw |bih|ku |tan|bos|nde|uro|y a|utu| no|i y| yi|ya |puz|zam|eny","plt":"ny |na |ana| ny|y f|a n|sy |aha|ra |a a| fa|n n|a m|y n|an | fi|tra|any| ma|han|nan|ara|y a| am|in |ka |y m|ami|olo| ts|min|lon| mi| sy| na|a t| ol|fan|a i| ha| iz|iza|man|ina|ona|aka|y h|ian|o a|a h|reh|a s|etr|het|a f|on |ire|fah|tsy|mba|ay |zan| hi| ar|ndr|ira|y o|y t|ehe| an|o h|y i|afa|ren|ran| zo|ena|dia|amb|amp|ala|zo |ika|y s| di|tan| az|y z|m p|rin|ia |n j| jo|jo | dr|a d|zy |ao |ry |and| ka|dre|mpi|rah|nen|haf|n d| ir|eo |elo| ta|omb|rai|oan|fa |am | pi|ene|ho | ho|ant|iny|itr|azo|dra|ava|tsa| to|tsi|zon|asa|van|a k|ari|ha |n i|mbe|ray|fia| fo|sa |ony|isy|ova|lal|ly |azy|o f|bel|lom|ham|mis|sam|zay| ra|oto|fir|ban|a r|nat|kan| vo| he|ito|ary|nin|iha| re|a e| ko|tok|fit| no|ita|iar|fot|nam|voa|isa|y v| sa|y r|o n|no |aly|mah|har|ain|kam|aza|n o|otr|eri|hev|oka|sia|ial|atr|y l| la|ila|oa |y d|ano|ata|its|tov|pia|y k|pan|fam|oko|aro|nto|pir| ao|ty |anj|nja|reo| as|o s|hia|o t|mpa|mit| eo|ais|sir|air|ba |tin| it|ver|ino|vah|vy |ton|tao|ank|era|rak|kon|a z|tot|ive|ame|aho|hoa|hit|ati|ity|o m|mik|a v|ani|ori|koa|hah|nga|dri|eha|dy | mo|oni| za|ato|bar|jak|n t|nao|end|eve|lah|aov|mia|izy|lan|nar|ria|ama| pa| mb|aln|lna|ifa|za |to |dro|va | in|ind|ehi|n k|iva|nta| va| al|via|rar","qug":"una|ta | ka|na |ka |ash|cha|a k|ari|ish|kun|kta|pak|ana|hka|mi |shk|apa|ach|hay|akt|shp|man|ak | ch| ha|ata|rin|lla|tak|ita|ami|ama|aku| pa|har|pas|ayñ|yñi|ina| ma| ru|uku|sh |hpa|run|kuy|all|aka| tu|tuk|an |chi|yta|a c|chu|in |ñit|ris|a h|nka|nak|tap|kan| ki|ayt|pi |pa | sh|i k|nap|a p|pay|kaw|kam|nam|ayp|aws|wsa|a s|ank|nta|iri|uy |a t|hin|a m|ay | li|ant|kay|lia|nat|a r|shi|iak| wa|lak|uya|say|yuy|y r|ypa|kis|a a|hun| yu|n t|tam| ti|n k| ya|yay|lli|a w|hpi|api| al|un |yku|ipa|a i|iku|ayk|shu| sa|ush|pir|ich|kas|kat| il|huk|ill|a y|hu |rik|yac|a l|kac| ku|hik|tan|ypi|wan|ika|i c| ni|ima|ila|ink|ayl|yll|mac|nis| ta| wi|kus|i y|i p|n s|llu|tin|la |yan|kpi|awa|li | ri|may|tik|iks|lan| pi|aya|kin|yas|ksi|kll|kak|lat|aym|ura|war| ay|k h|uch|akp|sha|ukt|nch|h k|i t|ull|uma|mas|iya|kir| ii|h m|pip|n p|kik|iki|i s|kar|aki|riy|han|y h| su|mak|n m|tac|nal|nac| ña|k k|k t|k a|iwa|mam|i m|nki|yma|wil|his|pal|i i|asi|nmi|i w|sam|k l| hu|sum|pam|kap|k i|pan|iia|huc|ik | mu|mun|pik|was|k m|ma |hat| im|k r|akl|u t|ha |llp|a u|wak|has|anc| ak|imi|mal|y k|ian|iña|tar|yka| iñ|iñi| mi|n y|ywa|uyk|unk|a n|arm|rmi|h p|pur|akk|kim|san|ati|uti|uri| ar|sak|i a|hap|iyt|ayw|si |yar|las|lpa|ñaw|awp|wpa|i r","mad":"an |eng|ban|ng | sa| ka|dha| ba|ren|ak |ang| se| ha|hak| dh|na | pa|adh|se |a s|aba|n s|ara|ngg|are|ha |aga|sa | or|sar|ore|asa|ana| ma|a k|aan|gi |ale| ag|gad|a b|n o|n k|ra |ala|eba|gan| ke|dhu|aja|ota|bas|man|dhi|n b|tab|ka |sab|ama|beb|abb|at |nga| ta|ggu|ako|pan|huw|uwi|wi | ot|san|a d|ata|eka|i h|bba|agi|ba |lak|hal|ong|kab|em |g a|lem|a o| pe| na|par|ane|ngs|nge|gar|a p|tan|gsa|a a|ran|ken|i s|guy|uy |k h|n p|n a|ada|al |apa| ga|on | an|g s|ta |kaa| e |e d|pon|nek|ssa|a m|kal|a e|e e| la|kat|ona|abe|nan|asi|jan|ate|lab|ri |sal|lan|i p|sad|aka|e a|a h|ari|ena| bi|oss|si |daj|i k| ng|har|gen|ton|e k|epo|ano|bad|car|n d|ar |era| be|nag|kon|g k|ase|nya|nos|n n|mat| kl|mas|ela| da| al|n t|uwa|wan|sae|pad|ggi| so|as |hi |adi|a n|i d|g e|k k|ne |oan|uan|k s|k a|e b|ah |ina|kla|ter|om |gap|le |koa|yat|per|neg|ega| ja|bi |abi|aha| ep|aon| as| mo|n h|i a|one| di|ma |kas|m p|di |aya|nto|int|n e|te |bat|epa|nda| ca|pam|e s|amp|to |dra|ann|oko|rga|nna|e p|g p|nta| ra|and|i b|nao|k d|pen|aen|ste|ila|yar|a t|mpo|ok |set|n m|k b|isa|kom|raj|arg|ika|bin|ant|ga |hid|idh|aju|i m|nas|kar|mos|ost| ho|lae|dil|t s|a l|das|rek|tad| a | po|ett|tto| to|bis| dr|jat|add| ko|ent|gam|e m|ndh|hig|iga|maj","nya":"ndi|ali|a k|a m| ku| nd|wa |na |nth| mu|yen| al|ra |thu|se |hu |nse|di |a n|la | pa| wa|mun|unt|nga| la|a u|u a|e a| ma|za |ons|ace|ce | lo|iye|a l|idw|ang| ka|kha|liy|ens|li |ala|ira|pa |ene|i n|we |e m|era|ana|dwa|lo |hal|ulu|ko |dzi|iko|yo |o w| ci|a p|ga |chi| mo|o l|lu |o m|zik| um|moy|oyo|ufu|ner| an|and|iri|umo|ka |a a|dan|ena| uf|ful| nc|nch|hit|ito|to |a c|kuk|dwe| da|fun|wac| dz|e l|kap|ape|a z|e k|ti |u w|ere| za|lir|pen|aye|tha|kut|ro |mu |lid| zo|ofu|ing|i m|amu|mal|o c|kwa|mwa|so |o a|o n|i p|eza| mw|nso|iro|zo |i d|lin|ri |edw| a |i l| li|a d|kul|ati|uti|una|lan|i k|o k|ung|alo|dza|i c|o z|a b|uni|iki|lam|mul|ulo| ca|nkh|nzi|gan| na|ant|e n|san|tsa|wir|oli|u k|lon|dip|ipo|unz|yan|gwi|ca |ome| ko|aku|akh|pon|ngw|kir| po|uli|gwe|cit|mer|pan|kup|ame|mba|tsi|bun|ukh|ope|siy|iya| ya| am|han| bu|ama|bvo|vom|rez|lac| kw|men|u n|ao |pez| on|zid|osa|u o|i a|nda|e p|ne |ank|hun|o o|nik|ku |its|adz|u d|aka|diz| kh|ina|ezo|ndu|kho|okh|ya |awi|izo|ans|pat|eze|khu|zi |phu|kus|eka|o p| ad|mol|ets|sa |iza|kwe|wez| un|izi|oma|ma |oci|du |ula|ani|lok|haw|ika|ja |say|nji|jir|amb|ats|sid|mai|aik|mak|aph|i u|isa|lal|u m|ogw|no |oye|ukw|osi|sam| si|win| zi|ni |tse|si |e o|opa|emb| ba|ban","zyb":"bou|aeu|enz|nz |eng|iz |ih |uz |uq |ing| bo|oux| di| ca|z g|dih|ux |ngh|cae|gen|euq|z c|ng |you|ung|ngz|ij | mi| gi|miz|aen| ge|z d| ci|gya| yi| de|ouj|uj | gu|cin|ien|ngj| mb|mbo|dae|zli|gij| se|j g|ang|z y|j d|ouz| cu| ba|nae|h g| da|yin|oz |de |z b|nzl|li |nj |x m|euz| cw| yo|iq |gz |q g|x b|yau|h c|vun|inh|ix | ga|cwy|wyo| nd|vei|nda| ro|rox|oxn|z m|i c|j b| si|wz |gh | gy|cun|gue|xna|unz|hoz|can|bau|ei |z h|yen| li|inz|dan|q c| hi|gj |uh | vu|faz|yie| bi|zci|hin|goz|uek| fa|gun|aej|ej |ya |nh | ae| go|au |ciz|den|h m|nq |ngq|ouq|gva|z s| do|ci | wn|q d|eix|h d|ekg|kgy|q s|hu |u d|j n|auj|j c|gai| ha|az |nhy|z l|gjs|jso|sou|ou |bin|sin|lij|h s|sev|eve|nei|q y|aiq|sen|h y| la|enj|ouh|i b|vih|din|q n|awz|j y|z r|enh|en |uen|bwn|wng|ozc|z n|anj|j s|liz|g g|g b|i d| ne|bae|awj|sei|eiq|hye|anz|oen|hix|zda|gak|ez |anh|u c|z v| ya|h f|x d|in |ghg|bie|enq|zsi|ghc|hci|siz|i g|n d|h b| du|cou|ngg|ngd|cuz|eiz| ho|dun|g c|law|j m| dw|env|nvi|dei|a d|ek |yaw|wn |giz|gzd|nzg|wnj|gda|ak |nde|auy|yuz|hgy| co|ujh|jhu|e c|hen|ujc|min|izy|g d|gzs|daw|aw |g y|ozg|ai |iuz|x l| na|iet|aih|gih|iuj|zbi|uyu|coz|sae|i m| he|zdi|dwg|q b| fu| ve|guh|iqg|qgy|yai|yoe| so|biu|vaq|aq |yun|izc| ra|cie|zge|n g","kin":"ra | ku| mu|se |ntu|a k|tu |nga|umu|ye |li | um|mun|a n|unt|ira| n |ere|wa |we | gu|e n|mu |ko |a b|e a|o k|a u|a a|u b|e k|ose|uli|ro | ab|aba|gom|e b| ag|omb|ba |ugu|ang|o a|gu |mba| ib| ub|eng|ihu|za | bu|ama| by|hug| ba|o b|e u|kwi|ga |ash|ndi| ka|yo |e i|ren| cy| ak|iye| bi|re |ora|igi|gih|ban|ubu|di | nt| kw|gan|a g|aka|aga|nta|a m|iro|a i| am|ku |i m|ago|byo|ta |ka |cya|ibi|and|na |ali|uba|sha| bw|ili|yan|no |ese| ig|u m|o n|kan|ish|ana|sho|obo|era| we|ya |aci|i a|ura|wes|uko|e m|ran|o i|u w|uru|wo |kub|n a| im|ber|hob|bor|ure| no|ani|u a|gac|cir|o m|ush|bur|eke|ne |wiy|ara|nge|rwa|yos|e y| y |uga|bwa|ho |zo |ind|ane|mwe|iza|are|rag|ge |mo |bwo|bul|teg|ege|u k|u n|n i|ze |aha| uk|bye|anz| al| ki|bah|uha|ite|kug|gir|ngo|go |age|ger|u g|zir| ry|ugo|bih|akw|o g|guh|iki|bat|iby|gar|imi|mbe|y i|n u|ha |atu|mul|tan|eye|e c|kim| ni|shy|aho|tur|kir|ate|abo|je |bo | ng|u u|ata|o u|iko|gus| bo|bos| gi|a s|nir| ru|gek|i b|eza|i n|nzi|i i|rez|kur|ako|any| as|ung| se|bis|nya|o r|uki| ya|ngi|mat|eko|ugi| in|o y|kor|imw|rer|bak|yam|bit| ik|kar|ire|ige|shi|hin|ing|byi|nu |mug| at|yem|eme|gaz|irw|yer|rek|key|ihe|gen| ic|icy|hak|but|ets|tse|eze| ur| na|bag|awe|ubi| yi|i k|ezo|tek|ubw|rya|uza","zul":"nge|oku|lo | ng|a n|ung|nga|le |lun| no|elo|la |wa |e n|ele|ntu|tu |gel|we |ngo| um|e u|thi|uth|ke |hi |ni |ezi|lek| ku|nom|ma |o n|onk|nke|pha|gok|a u|nel|ulu|unt|o l|kwe|oma|o e|ang|lul| uk|kul|a k|eni|uku| wo|kel|hla|mun| lo|ama| ne|ath|ho |umu|ela|won|elw|lwa|ban|a i|ule|zwe|ana| un|une|ing|lok|aka|elu|wen| kw|aba|tho|akh|khe|ala|gan|o y|enz|ko |thu|na |u u|a e|gen|i n|zin|kho|enk|kun|mal|alu|e k|lel| na|kat|e a|nku|eko|he |hak|lan|kwa| ez|o a|o o|kub|ane|ayo|yo |lwe|eth|obu| em|nzi| ok|okw|kut| ba|ile|ben|het|eki|nok|nye|ike|i k|so |isi|ise|esi| ab|mph|nhl| is|aph|fan|ga |isa|ini| ye|e i|nen|uba|ba |zi |hol|ka |ant| fu|fut|uhl|abe|and|do |ukh|kuk|eke|a a|kil|e w|the| ya|nda|za | im| in|olo|ekh|eli|ith|khu|eng|yok|nis|sa |kuh|o u|any|ye |e e|i w| ak|olu|ndl|a o| le|ne |ume|mel|eka|mth| ko|emp|isw|amb|emi|no |uny|iph|i i|zo |kuf|nay|ind|ezw|kuz|vik|alo|o w|hul|ebe|lin| yo|kan|eze|ndo|uph|hlo|yen|enh|phe|ufa|ake|ale|kug|fun|und|wez|li |seb|a l|ula|wam|din|ahl|nez|yez|nya|bus|bo |azw|o k|ink|kek|nan|i e|ola|izi|mbi|ili|han|kuv|ase|hel|hut|a y|kis|kuq|da |omp|swa|kup|nem|ano|phi| ol|azi|ubu|o i|kol|oko| el|e l|huk|ani|nje|sek|uke|lon|pho|kom|lak|kus|zis|ham|mba|izw|ulo|hun|i u|u n","swe":" oc|och|ch |er |ing|för|ar |tt |en |ätt|nde| fö|rät|ill|et |and| en| ti| rä| de|til|het|ll |de |om |var|lig|gen| fr|ska|ell|nin|ng | ha|ter|as | in|ka |att|lle|der|und| i |sam|lla|fri|ghe|ens|all|ör |na |ler| at|ete|den| el| so| av|av |igh|r h|nva|la |r r|env|ga |tig|nsk|iga|har|t a|som| ut|tti|nge|t t|ion|a s|ns |a f| sk|a o|r s|män|an |är |isk|rna| st| si| vi| sa| al|t f|ra | be|a r| är| me|ati|n s|lan| va| an|med|tio|ern|nna|t e| un|äns|ta |nat|sta|ig | åt|ten|kli| gr|vis|t s| la|äll|one|änd|han| ge| li|ans|stä|ner|t i| må|gru|ver|rih|ihe| mä|sni|lik|n f| re|r a| na|må |ers|t o|ad |r e|da |det| vä|ent|run|rkl|kla|ri |h r|nom|kap|igt|gt |n e|dig|uta|tan|e s|dra|s f|ed |d f|lar|rin|ran|upp|erk|tta|ika|änn|r o|erv|rvi|kte|vid|a i|lag| på|g o|id |ari|s s|r u|lin| om|ro |a m|els|isn|del|sky|r d|e m|mot|ot |vil|på | mo|r m|str|örk|ndl|on |i o|nd |tni|n m|ber|nad|gan|örs|r f|kal|era|a d|dd |je |itt| up|sin|nga|täl|ras|n o|ärd|i s|r i|enn|a n|n a| hä|bet|ski|kil|n i|lse|rel|t b|g a|kyd|ydd|arj|rje|l v|s e|end|amt| fa|nas| så|inn|tat|per|t v|l a|int|tet|öra|e f|tra|r g|yck|r ä|vär|ege|arb|d e|re |nis|ap |ara|bar|l s|t l|lit|när|lke|h f|ckl|v s|rän|gar|ndr|mt |se |häl|h a|llm|lmä|ess|sa ","lin":"na | na| ya|ya |a m| mo|a b|to | ko| bo|li |o n| li|i n| pe|i y|ngo|a n|a y|ki | ba| ma|kok|pe |la |a l|zal|oki|ali|nso|oto|ala|ons|so |mot|a k|nyo|eng|kol|go | ny|yon|nge|o e|ang|eko|te |o y|olo|oko|ma |a e|iko|e m|e b|lik|ko |o a|ako| ye|ye |ong|mak|si |isa| ek|aza|lo |sal|ama| te|o p|bat| az|e n|oyo|ani|ela|sen|o m|a p|ta |ban|i k|amb|ni | es|yo |aka|mba|osa| oy|mi |a t|eli|lis|i p|i m|ba |mok| to|mbo|bok|isi| mi|ing|lon|ato|o b| nd|ge |bot|ota| ez|nga|nde|eza|o t|kan|ka |gel|e k|bo |ese|sa |lam|koz|den|oba|omb| po|ga |mos|kop|oli|e e|yan|bon|oka|kob|lin|bik|po |kos| lo|sam|e a| ’t|’te|kot|ti |ngi| bi|e y|omi|esa|i b| el|elo|lok|gom|som|i t|ate|ika|kam|ope|a s|kat|ati|ata|wa |iki|i e|bom|tal| ka|oza|o l|bos|zwa|ola|pes| se|oke|bek|o o|ndi|bal|nda|nza|oso|omo|lak|bak|mis| at|bis|sus|usu|su |osu|lib|and|ozw|asi|ele|tel|mu |i l|e t|ase|mol|mob| nz|kel|ene|ne |mbi|ami|aye|nis|a ’|tan|le |obo|baz|pon|wan| ep|yeb|kum|sem|emb|mal|gi |nya|ote|e l|oku|bas| ta| ak| ti|tin|ina|gis|opo|ana|mab|bol|u y|mat|ebi|oti|mib|obe|a o|san| so|mbe|be | mb|ibo| et|ike|da | en|ben|za |yok|eni|tey|bwa|bi |kom|i o|gob|mik|umb|se |eba|e p|ibe|ale|lel|boy|eta|i a|bu |ime|sik|mon|ona|mel|ose|mwa|sol|geb|ebe","som":" ka|ay |ka |an |oo |uu |da |yo |aha| iy|ada|aan|iyo|a i| wa| in|sha| ah| u |a a| qo|ama| la|ga |hay| dh|ma |aad| xa|ah |a d| da|qof|in |aa |iya|a s|a w| si| oo|isa|eey|yah|xaq| le|ku |lee|u l| ku|taa| ma|la |dha|ta |aq |q u|eya|y i|ast|sta|a k|ha |of | wu|wux|uxu|xuu|kas|sa |u x|ara|doo|wax| am|iis|ro |a q|inu|nuu|ala|a x|o a|maa|nay| sh| qa|o i| aa|kal|le | lo|loo|f k|o d|ana|a u|o x| xu| xo| ba| uu|yad|iga|a l|si |dii|a m|yaa|gu |ash|u d|ale|ima|adk|aas| ca|o m|do |lag|add|na |lo |o k|san| is| so|adi| mi| fa|xor|dka|aqa|iin| he|aar|had|rka|a o|ado|dad|soo|mid|kar|aro|baa|qaa| ha|nta|o h|ad |u k|aga|dda| ga|hii| sa|u s| ay|har|axa|mad|n k|eed|quu|haa|daa|o q|aal|o s|n l|xuq|uqu|n i|id |hel|aya| ee| ho|nka|i k|uuq|nim|ina|ihi|elo|waa|dan|agu|ays|a h|saa|mar|ark|ya |ank|o w|naa|gga|ee |ax | bu|uqd|qda|rri|riy|n a| no|u h|n s|oon|lka|u a|laa|o l|ab |haq|uur|int| gu|ida|iri|lad|dhi|yih|ysa|dah|to |aam|ofk| xi|arc|rci|eli|ood|ool|orr|alk|goo|ayn|e u|n x|h q|asa|sag|a c|sho|ami|i a|n q|siy| ug|kii|o u| ta| ge|gel|agg|a g| di|ido| ji|hoo|a f|al |jee|dal|ago|ii |a b|mo |iir|ooc|bar| ci|caa|xir|ra |aqo|sig| mu|aba|oob|oba|u q|aaq|aab|sad| ra|cad|dar|imo|ar |y k|fka| du|xay|y d|ras|o c|ari","hms":"ang|ngd|gd |ib | na|nan|ex |id | ji|ad |eb |nl |b n|d n|ud | li|jid| le|leb| ga|ot |anl|aot|d g|l l|b l| me|ob |x n|ngs|gs |mex|nd |d d| ne|jan|ul | ni| nj|nja| gu| zh|lib|l n|ong| gh|gao|b j|b g|nb |l g| je|jex|gan|ngb| ad|end|el |gb |han| sh|ub | da|d j|t n|d l| nh|nha|b m|is |d z|x g| ya| wu|she|l j|oul|il |nex| ch|b y|d s|gho|gue|uel|wud| gi|d y|hob|nis|d b|s g| zi|lie| yo|es |it |nx |ies|aob|gia| de|eib|you|ian| hu|s j|d m| ba|zib|oud|b d|chu|ut |t j| do|ol |at |hud|nen|hen|s n|iad|ab |zha|t g|dao| go| mi|enl|x j|enb|b z|hei|eit|nt |b s| ze|d c|al |inl| xi| se| re|ren|hao|d h| fa|ngx|gx |anb|gua|yad| ho|x z|fal|b w|nib|ix |b h|and|had|t l|x m|gou|d x|bao|ant|don| xa|yan|d p|s z|hib|anx|zhe|ox |l d| pu| du|dan|gha|od |s m|sen|xin|lil|hui|uib|uan| we| di|b x|oub|t h|hub|zhi|t z| ju| ge| ng|t m|hol|xan|pud|x l| ma|jul|eud|hea|l s|enx|l z|jil|zen|aos|os |s l|d r|dei|ngt|gt | yi| he| si|nga|heb|zho|hon|did|d a| lo|b a|x c|dud|b b|lou| bi|dou|geu|b c|d k|x a|d w|wei|x b|l h|x d| qi|bad|t w| bl|blo|aod| nd|nia|deb| ja| sa|eut|ax |eab|s a| bo|lol|sat|ngl|gl | to|l m| pa|pao|b f|lia|x s|heu|t s|che| ca|can|s w|s y|sib|mis|zei|ux | pi|x r|gon|t p|jib|iel|d f| cu|ghu|unb|t c|inb| ko|x x","hnj":"it | zh| ni|ab |at | sh|ang|nit|os | do|uat|ox |ax |nx |ol |ob | nd|t d|x n|nf |zhi|as | ta|tab|ef |if |d n|ad | cu| mu|cua|uax|mua|uf |b n|ib |s d|dos|id |enx|hit|nb | lo|f n|t l|ngd|gd |inf|us | go|ux |ed |she|b d|t n|b z| ho| yi|x z|aob|l n|t z|ong| zi|ix |nda|d z|yao|uab|enb|ut | de|f g| dr|dol| yo|zhe| le|euf|x d|inx| ne|nen|das|dro|ngb|gb | ge|d s|s n|f z|uef|hox|len|b g|il |ud |nd |gox| ua| na| du|x j|f y|oux|x c|han|ndo|of |f h| ja| gu| ny|zha|s z| da|uad|heu|lob|shi|ik | bu| ji|hai|ged|od |b h|t g| ya|ngf|gf | hu|ex |bua|you|rou|nil|hen|yin|zhu|out|ous|nya|is |f d|enf|b c|af |dou|lol|nad| re| ha| xa|uk |t s| id|xan|sha|hua|jai|b y|aib| qi| la|s s|d d|l m|ot |hue| xi|x g|x l|ren| kh| dl|ait| ba|aod| zo| ju|jua|zif| nz| ga| di|bao|x y|b s|x s|xin|aof| li|b b|x m|x t|eb |b l|ngx|gx |dax|b t|hef|gua| be|las|d j|s t|hed|nzh|l d|t y|hif| pi|f b|d l| ib|t h|f l|hou|dus|hun|und|s l|t r|el |uas|gai|ngt|gt |hab|aos| mo| zu| bi|f t| za|d y|x h|aik|k n|end|aid|ros| gh|zos|pin|ak |s x|d g|f s|s y| ao|k z|s b|due|mol| fu|dex|iao|x b|hik|x i|deu|l b| bo|b k|s m| lb|lb | hl|lan|uaf|d b|zho|al |eut| ro|ub |et |t c|d m|x x|d h| ch|d p|f x|t b| nt| su|uak|zis|shu|t t|gha|yua| we|oud|gon|d t","ilo":"ti |iti|an |nga| ng|ga | pa| it|en | ka| ke| ma|ana| a | ti|pan|ken|agi|ang|a n|a k|aya|gan|n a|int|n t|ali|lin|a m|dag|git|a a|i p|teg|a p|nte| na|man|awa|kal|da |ng |ada|ega|nag|way|na | da|n i|sa |i k|n k|ysa|n n|al |a i|no |add|aba| me|eys|i a|nna|dda|ngg|mey| sa|ann|pag|ya |gal| ba|mai| tu|gga|ung|i s|kad|yan|tun|nak|wen| ad|aka|aan|enn|nan| ag|asa|i n|wan| we|nno|yaw|i t|l m|ata| ta|ami|a t|apa|ong| si|li |i m|kas|aki|ina|ay | an|n d|ala|a s|g k|gpa|mak|eng|ili|n p|et |ara|at |ika|ipa|dad|ama|nai|g i|yon| aw|in |ao |toy|oy |ta |on |aen|ag |bab|ket|aik|ily|lya|sin|tao|ani|agp| ki|a d|bal|oma|ngi|uma|g a|i i|kin|naa|bae|o k|y n|daa|gil|o t|iwa|ags|pad| am|syo|i b|kab|sab|ida| um|mil|aga|gim|ar |ram|yto|san|tan|min|pap|n m|eg |agt|o n|a b|aar|asi|ino|nom|nia|n w| wa| de|dey|pam|i e|sal|bag|saa|iam|eyt|day|kit|ak |ed |gsa|lak|t n|ari|nay|kan|nat|t k|i l|i u|sap| gi|g n|aw |sia|o p|o i|dum|i g|to |uka|agb|bia|aib|lub|ubo|ged| li|apu|pul|lan|imo|mon|y a|ma |pak|ias|sta|den|i d| id|bas|kai|gin|i w|kap|ita|asy|kni|kar|bon|abi|ad |umi|ban|agk|akd| ar|mid|din|sar|iba|nnu|inn|o m|ibi|ing|ran|akn|nib|isu|abs|maa|kda|aip|as | la|o a|t i|idi|nto|lal|amm|aad|or |adu|kua|ais|nal|w k|ulo|y i"},"Cyrillic":{"rus":" пр| и |рав|ств| на|пра|го |ени|ове|во |ани| ка|ть | по| в | об|ия |лов| св|сво|на | че|о н|ело|ост| со|чел|ие |ого|ния|ет |ест|аво|ажд|ый | им|век|ние| не|льн|име|ова|ли |ать|т п|при|каж|и п| ра|или|обо|жды| до|ых |дый|ек |воб|бод|й ч|его|ва |ся |и и|мее|еет|но |и с|аци|ии |тва|ой |лен|то | ил|ных|к и|енн|ми |тво| бы| за|ию | вс|аль|о с|ом |о п|о в|и н|ван|сто|их |ьно|нов|ног|и в|про|ако|сти|ий |и о|бра|пол|ое |дол|олж|тор| во|раз|ти |я и|я в| ос|ным|нос|жен|все|и р| ег|не |ред|тел|ель|ей |сно|оди|о и|а и|чес|общ|тве|щес| ко|ним|има|как| ли| де|шен|нно|е д|пре|осу| от|тьс|ься|вле|нны|аст|осн|а с|одн|ран|бще|лжн|быт|ыть|сов|нию| ст|сту|ват|рес|е в|оль|ном|чен|иче| ни|ак |ым |что|стр|ден|туп|ду |а о|ля |зов|ежд|нар|род|е и| то|ны |вен|м и|рин|нац|вер|оже|ую | чт|она|обр|ь в|й и| ме|аро|ото|лич|нии|бес|есп|я п|х и|о б|ем |е м| мо|дос|ьны|тоя|еоб|ая | вы| ре|и к|кот|ное|под| та|жно|ста| го|гос|суд|ам |ава|я н| к |ав |авн|ход|льс|нст| бе|ово|и д|ели| дл|для|ной|вов|ами|ате|оро|дно|ен |печ|ече|ка |еск|ве |уще|в к|нен|мож|уда|о д|ю и|ции|ког|вно|оду|жде|и б|тра|сре|дст|от |ьст|е п|нал|пос|о о|вны|сем|азо|тер|соц|оци|циа|ь п|олн|так|кон|ите|обе|изн| др|дру|дов|е о| эт|х п|ни |еди|дин|му ","ukr":"на | пр| і |пра|рав| на|ння|ня | за|ого| по|го |ти |люд| лю|во | ко| ма|юди|льн|их |аво|о н| не|анн|дин| св|сво|кож|ожн|пов|енн|жна| до|ати|ина|ає |а л|ува|не | бу|обо|аці|має| як| ос| ви|є п| та|аль|або|них|ні |ть | ві|ови| аб|бо |а м|ере|і п|без|вин|при|о п|ног|іль|ми |ом |та |ою | бе|ста|воб|бод|до |ост|ті | в | об|ва |о в| що|ий |ся | сп|і с|від|нов|кон|и п|ств|инн|нан|ван| у |дно|она|ват|езп|пер|но |ій | де|ії |ідн|и і|сті|під|ист|нні|ако|ьно| мо|бут|ути|ід |род|і в|що |ава|тис|а з|вно|ну |и с|ої |і д|ду |а в|ів |аро| пе|ний|а п|му |соб|яко|спр|і н| рі|рів|чи |ним|ля |нар|лен| ін|у в|нен|ому|нац|ися|и д|ова|ав |і р| ст|ові|нос| пі|ють|сть|ово|про|одн|у п|віл|овн|вни| ро| її|її | вс|ном|і з| ра| су|мож|чен|ві |буд|іст|івн|оду|а о|ни |сно|ими|а с| со|ьни|роз|и з|зна|я і|о д|х п|е п|о с|и в|дер|ерж|им |чин|рац|ції|і б| од|а н|сі |сту|тер|ніх|ди |їх |нна|так|о з|я н|заб|зпе|у с|спі| ні|е б|ржа|осо|я п|в і|кла|то |а б|осн|рим|сві|віт| дл|для|тва|ами|зах|рес| ре|ков|тор|соц|оці|ціа|і м|ки |тан|абе|печ|ког|ага|гал|ту |ї о|е м|оже|же |удь|ніс|ара|руч|авн|и щ|ною|я в|всі|кої|ини|ь п|осв|і і|ахи|хис|іал|а і|оди|тво|жен|нь |нал|ваг|аги|ги |інш|лив|х в|заг|роб|піл|в я|ком|об |о у|жав|і о","bos":" пр| и |рав| на|пра|на |да |ма |има| св|а с|а п| да| по|а и|је |во |ко |ва | у |ако|о и|но | за|е с| им|аво|ти |сва|ава|о н|и п|ли |или|и с|вак|ост| ко|их |не |а у| сл|вањ| не| др|ње |кој|ије|ња |и д| би|ств|им |у с|јед| ил|сло|лоб|обо|бод| је| ра|при|ање|вје| об|а д|ом |се | су|е и|ју | се|сти|и и|а б|дру| ос|е п|вој|циј|у п|о д|а о|раз|су |ања|а н|ује|ова|у и| од|и у|ло |едн|ни |у о|ово|аци|ити|о п|а к|оје|жав|нос|дје|е о|бра|пре|шти|а ј|про|и о| ка|них|бит| тр|тре| бу|буд|у з|ог |ста|ја |држ|ржа|е д|миј|сво|реб|авн|ија|и н|е б|ђи |пос|ту |аро|род|ред| ње|ба |а з|ка |де |ем |ају|ива|ве |е у|јер|бил|ило| из|ени|ду | до|а т|за |еђу|нар|тва|одн|њег|гов| са|ним|м и|вим| ни|у д|јел|о к|оји| см|дна|уђи| ст|алн|ист|и м|еба|ран|ичн|вно| дј|у н|ода|нак|е к|ан |нов|сно|сту|нст|ено|чно|ани|ном|е н|тив|нац|аве|и б|сми|чов|овј|осн|а р|нап|ови|анс|дно|оја|ног|м с|еди|ара|ој |ну |кри| кр|оду|ико|рад|ник|туп| чо|јек|тво| вј| ми|тељ|обр|жив|заш|ашт|тит|уна|его|под|сам|о о|руг|ји | мо|ву | ов|х п|уду|рив|ење|дст|те | те|а ч|вни|сви|и в|ина|и т|ра |ите|у у|иту|међ|ак |дни|ниц|њу |нич|одр|вољ|ави|г п| оп| та|рим|кла|е т|ао | вр|акв|тно|мје|дуђ|она|ада|сто|оби|едс|то |оди|о с|ку |риј|у м|од |ичк|вен","srp":" пр| и |рав|пра| на|на |ма | по| св|да |има|а п|а и|во |ко |ва |ти |и п|ако| у |а с| да|аво|ост|и с| за|о и|сва| им|вак|је |е с|ава| сл|о н| ко|ња |ом |но | не|не |ли |у с| др|или|сло|обо|кој|их |лоб|бод|им |а н|сти|ств|а о|ју | ил| би|при|а у| ра| је|ог |јед|ње |е п|у п|ни |а д|и у|едн|ити|нос|а к|о д|ање|ова|про| су|и и| ос|вањ|ста|дру|е и|циј|се |род| об|и о|ања|ају|е о|ове| де|аци| ка|ово|ја | ни| од|ве | се|и д| ст|м и|авн|и н|ује|ени|ија|дна|жав|у и|ред|су |нов|оди|вој|тва|е б|оја|што|у о|ара|а б|држ|ржа|одн|ним|ран|пош|ошт|а ј|ка | ов|у у|ду |аве|осн|сно|шти|аро|раз|бит|а з|у з|ења|де | из|них|о п|у д|е д|пре|ву | тр|ту |еђу|нар|гов|без|ичн|за |вно|ло |у н|оји| са|то |ан |нак| ме| ње|чно|сво|вим|нац|ода|ји |ани|ме |ико|ник|ика|е к|пос| кр|тре|реб|нст|сту|е у|ку | до|ашт|тит|алн|дно|њег|ном|ног|м с| вр|о к|ој |чов|анс|ови|о с|бра|те |тав|туп|ено|жив|заш|ем |и м|дни|вар|рив|руг|вољ|ави|штв|е н|као|ао | ли|ст |ило|њу |сме|о ј| см| чо|оду|вре|дст|од |а т|кри| бу|буд|и в| ве|вер|а р|дел|тво|међ|оје|м п|ављ|его|под|ена|уги|ла |пор| оп|руш|ушт|ком|еди|ба |кла| мо|и б|как|акв|рад|ну |век|рим|гла|јућ|уде|вни|еба|е р|сви|м н|иту|тер|ист|а ч|пот|рем|ниц|у в|х п|ива|сам|о о| он|езб|збе","uzn":"лар|ан |га |ар | ва| би|да |ва |ир | ҳу|ига|уқу|бир|ҳуқ|қуқ|ган| ҳа|ини|нг |р б|иш |ни | та|лик|инг|ида|а э|или|лиш|ари|нин|иши| ин|инс|он |ади|нсо|сон|ий |лан| ма|дир|кин|и б|ши | бў|ҳар|бўл| му|уқи|дан|ила|қиг|р и|қла| эг|эга| ўз|а б| эр|эрк|кла|қил|оли|ки |гад| ол|нли|лга|и ҳ|рки|лиг|иги| қа| ёк|ёки|иб |н м| ба| қи|н б|ри |ара|атл| бо|ҳам|лат|бил|ин |р ҳ|а т|ала|лаш|бош|ик |инл| эт|ш ҳ|а ҳ|и в|ниш|тла|эти|тил|мас|а қ|и м|оси|им |ат |уқл|арн|рни|қар|ани|а и|ўли|ги | да|н ҳ|риш|мла|ли |и т| ха|арч|рча|ча |бар|аси|ўз |а а|рла| бу|а м|лин|ати|ият|либ|таъ| ту| ас|тиб|аро|а о|ун |тга|р в|икл| бе|мум|н қ|али| те|сид|ш в|мат|амд|мда| ке|лла|шга|н э|дам|амл|хал|ола| қо|ири|ирл|илл|а ш|рга|иро| шу|тиш| де|умк|мки| эъ|тен|енг|а ў|рда| са|гин|имо|тар|а ё|ур |рак|алқ| ки|аза|к б|ода|сий|а к|тни|ўлг|н в|нда|шқа|зар|н о|и қ| ми|мил|р т| си|ак | ша|ор |кат|ера|сиз|ам |асо|сос|н ў|шла|н т|нид|ошқ|й т|ана|ти |рин|асл|бу |син|дав|илг| со|ас |нга|лак|ино|ъти|муҳ|а в|аш |бор|лим|уни|лли|н и|си |и э| ка| то|а д| жа|ами|қон|на |риг|лма|кер|авл|вла|и а|дек|екл|ят |ака| эм|эма|эът| ҳе|ҳеч|еч |ким|икд|кда|сит|лад|и ў| ни|ник|ага|и о|и с| уч|учу|чун|аъл|ъли|анл|аёт| иш|а у|ўзи|диг|ай |ада|оий|мия|тда|а с","azj":" вә|вә |әр |лар| һә|ин |ир | ол| һү|һүг|үгу| би|гуг|на |ләр|дә |һәр| шә|бир|ан |лик| тә|р б|мал|лма|асы|ини|р һ|ән |шәх|әхс|гла|ары|а м|дир|али|аг |угу| ма|илә|ын |уна|јәт| ја|ара|икд|ар |әри|әси|р ш|рин|әти|дән|нин|н һ| аз|јјә|син| мү|тин|ни |зад|ијј| мә|әрә|мәк|үн |нда|әт |и в|ыны|нын|ндә|ә а|аза|рын|гун|олу| ет| га|лыг|илм|кди|лә |ә ј|әк |лмә|ына|инд|олм| ин|хс |мас|сын|лун|ә б|да |н т|әми| бә|адл|длы|н м|нә |г в|ја |тмә|бәр| он|ә һ|әја|сы |нун|етм|дан|инә|маг|ун |раг|ә в| ва|н а|н б|рлә|ә м|си |әра|н и|ынд| өз|аны|нма|инс|ама|ры |ығы|ли |ил | ал|ала| ди|ә д|ик |ирл|ләт|а б|бил|ыг |мүд| сә|ә и|ны |нла|әлә|дил|алы|ә е|унм|н в|ола|аси|үда|или| дә|нса|сан|угл|ә о|хси| һе|уг |әтл|һәм|әни|ејн|у в| да|тәр|мин|јин|кил|дыр| бу|лан|иш | һа|мәс| ки|ми |лығ|ә г|г һ|и с|даф|афи|фиә|р в| иш| әс|сос|оси|сиа|хал|алг| та| ас| ед|бу |һеч|еч |рә |јан|ы һ|ким|ији|ы о|ина|сиј|әса|сас|а г|јар|лы |түн| ис|ист| со|ал |н ә|ифа|әмә|ә т|мил|илл|лыд|ыды|ыр |әдә|ыгл|лиј|тлә|а һ|мәз| бү|бүт|үтү|ија|иә | үч|үчү|чүн|т в|дах|ахи|хил|р а|ылы|ман|сил| се|сеч|адә|иал|ону|өз | ҹә|миј|әји|н е|еди| ми| нә|а в|мән|рил|әз |илд|раб|абә|шәр|ғын|аја|зам| ни|улм| ха|тәһ|әһс|һси|и һ|сти|гу |вар|ад |там|уғу|з һ|ган|рәф|н д","koi":"ны |ӧн | бы|да | пр|пра|лӧн| мо|рав| да|быд|лӧ |орт|мор|ӧм |аво|ӧй | ве|нӧй|ыд |ыс | не|сӧ |ын |тӧм|во |сь |эз |льн|ьнӧ|тны| ас|д м|ыны|м п| и |сьӧ| по| ӧт|то |бы | эм| кы|тлӧ|эм | от|аль|н э|вер|ртл| кӧ|ӧ в| ко|ерм|ств|воэ| до|тшӧ|ола|ылӧ|вол|ӧс |ы с|ліс|ісь|а с|ас |кыт|тво|кӧр| се|нет|ето|шӧм|ӧдн| ме|мед| ол|злӧ| вы|ӧ д|ӧ к|та |аци|ӧ б|вны|лас| на|з в|ӧрт| во|на |а в|ась|ыдӧ| сы|едб|дбы| вӧ|лан|рмӧ| оз|оз | сі|ытш|оэз|ӧтл|ы а|оти|тир|с о|олӧ| чу|ись| эт|ция|рты|тыс|ы б|кол|ы п| го|сет|кӧт|тӧг|ост|тӧн|н б| со| сь|рті|ӧтн|н н|дз | ке|кер|о с|мӧ |ӧ м| мы|ис |а д|ӧг |дӧс|ест|нӧ |пон|онд|ы н|сис|нац|итӧ|н п|суд| уд|удж|выл| ви|эта|н м| эз|ана|ӧны|с с|ть |орй|йын|сси|рре|рез|ьӧр|ті |сыл|ысл|нда|мӧд|з к|а п|с д|ӧр |чук|укӧ|рны|ӧмӧ|кин|рт |овн|ӧт |она|нал| об|ӧ о|отс|лӧт|й о| тӧ|тӧд|дны|асс|кон|слӧ|ы д|скӧ|с в|с м|ытӧ|езл| ло|быт|осу|эзл|кӧд| ум|умӧ|мӧл|ӧ п|асл|тра| ст|ь м|сьн|ьны|ь к| ов|код|сть|а н|ы к|тла|а к|ӧтч|дор|иал|а о| пы|н к|оль| за|аса| дз|нек|а м|н о|етӧ|ӧ н|ерн| сэ|ы м| де| чт|что|йӧ |ы ч|еки|поз|озь|езӧ|вес|ськ|исӧ|ӧтк|тко|рйӧ|ион|ннё|з д|ӧмы|тсӧ|са |кыд|енн|соц|оци|циа|й д|пыр|зын|нӧя|ӧя |зак|ако| мӧ| а |еск|а б|ан |тӧ |гос|уда|дар|арс|рст|рлӧ|ӧ с| ли|эсӧ|оля|мӧс|ӧсь|дек","bel":" і | пр|пра|ава| на|на | па|рав|ць |ны |або|ва | аб|ацы|ае |аве| ча|анн|льн|ння| ма| св|ала|сва|не |чал|лав|ня |ых |ай |га | як|век|е п| ад|а н| не| ко|ага|пры|кож|ожн|а п| за|жны|ы ч|дна|бод|а а|цца|ца |ваб| ў |мае|ек |і п|ных|нне|пав|а с|асц|бо |ам |ста| са|ьна|ван| вы|одн|го |аць|наг|він| да|дзе|ара|мі |цыя|оўн|тва| ра|і а|то |ад |ств|аві|лен| ас|і с|най|аль|енн|і н|ці |аро|аво|рац|сці|пад|к м| яг|яго|іх |ама| бы|рым|род|і і|ым |энн|што| та|я а|нан|ана|нас| дз|ні | гэ|гэт|а ў|інн|а б|ыць|чын|да |оў | шт|ыі |а і|агу|які|ным|дзя|я п|цыі|і д|ьны|нар| у |ўна|оль| ўс|х п|нац|ыя |ах | ус|ымі|ля |амі|ыма| ні| гр|воў|ў і|адз|эта|іна|ход|о п| ка| ін|ы п|зна|нен|аба|быц|рад|ўле|чэн|ь с|чы |сам| ст|асн|і р|ду |аў |ера|ры |нал|жна|уль|рам| су|аны|кла|аюч|ючы|оду|ую |а р|ўны|маю|ука|кац| дл|для|ь у|пер|е і|нае|ако|і з|гра|адс|ыцц|яўл|і ў|яко|а з|кан| ро|роў|нст| шл|адн|ода|аса|аду|нав|вы |ы і| пе|і м|кі |але|х і|авя|алі|раб|мад|дст|жыц|раз|зе |нна|ані|х н|е м|ада|нні|ы ў|о н|дзі|я я|люб|аюц|бар|дук|ахо|а в|сац|авы|так|я ў|тан|зак|чна|заб|бес|я і|ваг|гул|ім |ган|зяр|ярж|ржа|жав|ве |е а|м п|ацц|од |ены| дэ|ну |у ш|нах|вол|а т|ога|о с| бе|інш|ака|усе|яна|ека|ка |сно|рас| рэ|ь п|ніч|чац|се |і к","bul":" на|на | пр|то | и |рав|да | да|пра|а с|ва |ств|та |а п|ите|но |во |ени|а н|е н| за|о и|ото|ван| вс|не |ки |те | не|ове|о н| по|а и|ава|чов|ия |ане|ни | чо|ие |аво| св| об|а д|е п|век|ест|сво| им|има|и ч|ани|ост|и д|ние|все|тво|или|ли |и с|вот|а в|ма | ра|ват|и п|сек|еки|ек |а о|и н| в |е и| ил|ова|при| се|ето|ата|аци|воб|обо|бод|к и|пре|ат |оди|раз| съ| ос|а б| бъ|ред| ка| ко|лно|ния|о д|бъд|о п|се | от|за |о в|ъде|ята| е | тр|и и|о с|тел|и в|от |ран|е с|нит| де|ка |бра|ен |общ|де |алн|и о|ява|ият|ция|про| до|нег|его|а т|нов|ден|как|ато|ст | из|а ч|тря|ряб|ябв|бва|а р|а к|вен|о о|щес|а з|ено|гов|тве|нац|дър|ърж|ржа|е д|нос|лен|ежд|род|е о|и з|вит| та|зи |акв|ез |она|обр|нар|нот|иче|о т| ни|кат|т с| с |йст|авн| бе|осн|сно|вни|пол|рес|аро|кой|зак|е в|тва|нен|е т|ува| ли|ейс|жав|едв|стр| ст|без|вси|сич|ичк|чки|вид|си |жен|под|еоб|нст| те|ди |ри |сто|ган| дъ|а е|и к| че|ода| ср|сре|ака|чес|и р|и м|т н|одн|о р|лич|елн| ре|бще|ник|ели|че |дви|еме|ира|жда|кри|лни| си|са | то|ой | ме|оет|гра|ход|дру|ичн|еди|дос|ста|дей|я н| къ|ан |ико|чре|й н|ави|нал|пос|тъп|ра |азо|зов|рез|той| со|меж|тно|т в|и у|нет|нич|кон|клю|люч|нео|чит|ита|а у|а м|дно|оят|елс|лит|ине|таз|ази| мо|що |т и|изв|тви|чен","kaz":"ен |не | құ|тар|ұқы| ба| қа|ға |ада|дам|құқ|ық | ад| бо|ына|ықт|қта| жә|ар |ың |ылы|жән|әне|мен| не|лық|на |р а|де |ін |ары|а қ| жа|ан | әр|қыл|ала|ара| ме|уға|н қ|еме|ның| де|іне|ам |асы|тан|лы |әр |да |ста|нды|еке|ығы| өз|ған|анд|ын | бі|мес| қо|бол|бас|ің |ды |етт|ып |ілі|н б|нде|ері|е қ|қық|бір|лар|алы|нем|есе|се |а ж|ы б| ке|тын| ар|е б|бар|ге |ост| ти|тиі|олы|ік |інд| та|аты|сы |е а|дық| бе|ы т|нда| те|ры |ғы |бос|ғын|луы|иіс|сын|рде|рын|еті|қығ|алу|іс |рін|іні|е ж|дар|ім |егі|н к|қар| ер|тті|н ж|ыры|аны|лға| са|уын|ынд|ыны|ы м|рға|ген|ей |тік|тер|нің|ана|уы |аза| от|нан| на|е н|гіз|тық|мыс|ы ә|мны|м б|өзі|сқа|қа |е т|ң қ|еге|ке |ард|нег|луғ|лан|амн|кін|і б|асқ|рал|ті |ру |айд|тта| же|а б|р м|рды|кет|аса|ді |өз |ама|дей|н н|тыр|ауд|ігі|лып| мү| ал|зін|лік|дай|мет|жас|бер|тең|арқ|рқы|а о|е ө|қам|елі|рлы|ы а|а т|дер|біл|р б|еле|қор|ден|тін|уда| тү| жү|кел|і т|ір |лге|ы ж|ең |а д|тты|оны|гін| ха|ркі|лде|е м|н т|түр|оға|ікт|кті|зде|жағ|уге|ауы|рыл|ұлт|лтт| ос|осы| то|ция|ы е|н а|ау | ау|ені| ел|н е|оты|шін|ыс |қты|імд| да|сіз|лма|кім|ң б|лім|қат|зі |орғ| әл|хал|ерк|ек |құр|тте|е д|ағд|ғда|елг| ас|ірі| ұл|ағы|амд|тал| со|рып|ылм|лін|ным|мас|сыз|дан|із |ірд|ай |гі |сты|ым‐|ң ж|с б"},"Arabic":{"arb":" ال|ية | في|في |الح| وا|وال| أو|ة ا|أو |الم|الت|لحق|حق |كل |لى |ان |ة و|الأ| لك|لكل|ن ا|ها |ق ف|ات |مة |اء |ما |و ا|ون |ته |الع|أن |ي ا|ي أ|شخص|ة ل|الإ| عل| أن|م ا|حري|الا|من |على|حقو|قوق|ت ا| شخ|لا |ق ا| لل|فرد|رد | أي|أي |رية| كا|د ا| ول| من| إل|خص |ا ا|وق |نسا|ل ف|ا ي|ه ا|ة أ|كان|ن ي|امة|جتم| حق|الق|ام |دة | لا|ل ش|إنس|سان|ين |ة م|اية|ن ت|ا ل|ذا | فر|ن أ|هذا|لة |اً | عن|ى ا|لتع|اسي| دو| حر|ع ا|ه ل|لك |ه و|ترا|له |ماع|د أ|ي ح|إلى|الج|الد|، و| با|ن و|ي ت|نون|لعا|مع | هذ|ة ع|لحر|يات|عية|ص ا| وي|لإن|لأس|أسا|ساس|سية|بال|ي و|حما|ماي| إن|الف|انو|ير |رام|ا و|عام|دول|مل |الو| مت| له|الب|ساو|ة ب|هم |ع ب|علي|ك ا|لقا|قان|تما|ة ت|ى أ|ول |ة ف|ا ب|اد |الر|ل و|ل ا|انت| قد|لجم|لمي|لتم|تمت|اعي|ليه|لمج|ه أ|ا ك|ال |لأم|لمت|لإع| يج|لدو|ق و|ريا|يه |رة |ن ل|دون|تمي|كرا|يد |ذلك| يع|ر ا|تعل|عال|تسا|لاد|اة |قدم|متع|تع |اجت| كل|مان|غير|اته|م و|مجت|تمع| مع|مم |لان|يجو|جوز|وز |عمل|دم |فيه|الض|ميي|ييز|متس| عا|أسر|ن م|معي|لات| مس|لاج|عن |ي إ|ليم|يم | أس| تع|يز |مية|جمي|ميع|الش|اعا|ة، |الس|شتر|لمس|لما|ني |لي |يها|ملا|ود |تي |لضم|ضما|اعت|ر و|اق |ي م|ي ي| بح| تم|تنا|أمم|تحد|حدة|إعل|علا|ه ع| جم|عة |م ب|ولم|الن|ل إ| به|ب ا|اوي|قد |أية|قيد|د ب|اك |وية|إلي|لزو|د م|مست|كاف|وله|ه ف| ذل| وس|لحم|نت | أم| مر|مرا| وأ| وع","urd":"ور | او|اور|کے | کے| کی|یں | کا|کی | حق|ے ک|کا | کو|یا |نے | اس|سے |ئے |کو | ہے|میں| می|ے ا| کر| ان|وں | ہو|اس |ر ا| شخ|شخص|ی ا| جا| سے|حق |ہر |خص |ے م|ام | یا|ں ک|ہیں|سی | آز|آزا|زاد|ادی|ائے|ہ ا|ص ک|ا ح|جائ|ہے |کہ |ر ش|ت ک| پر|ی ک|م ک|۔ہر|پر |ا ج|ان |دی |س ک|ق ہ|ہے۔|ر م|ں ا|ی ح|و ا|ار |ری |ن ک|کسی|حقو|قوق| مع|ے گ|ی ج|وق | ہی|ر ک|سان|نی |کرن| حا| نہ|تی |ی ت| جو|ئی |انس|نسا| کہ|اپن|ل ک|جو | اپ|ے ب|یت |نہ |ہ ک| مل|ہو |می |ل ہ|رے |ی ش|رنے|ے ل|ے ہ| کس| ای|ا ا|۔ ا|حاص|اصل|صل |معا|نہی|ی م|وہ |یں۔| تع|انہ|ق ک|د ک|ی ب|ات |ملک|ایس|ی ہ| بن| قو|قوم|کیا|ے، |عاش|اشر|ر ہ| گا| دو|یہ |وام|دہ |ں م|ا م| من|بر |انی|ے۔ہ|ر ب|دار|ے ج| وہ| لئ|لئے| عا|اقو|قوا|مل |ائی|علا|اد |ی س| جس|ر ن|ے ح|ہ م|کر |و ت|لیم| و | قا|انو|ا ہ|جس |یوں| یہ|لک |ریق|ے۔ |نیا|تعل| گی|گی |ر پ|دوس|ی آ|یم |، ا| اق|وئی|یر |پنے|ے پ|م ا|گا۔|یاد| رک|علی| مس|ی، |ین |ن ا|انے|وری|ی ن|لاق|ر ع|ون |خلا| با|ا س| سک| دی| چا|رائ|ومی|ہ و|نا |اری| بر|رکھ|ندگ|دگی|ر س|رتی| بی| شا|س م|ق ح|ادا| مم| ہر|ا پ|و گ|وسر|سب | پو|قان|نون| بھ|ے خ|اف | اع| مر|یسے| پی|غیر|ے س|ال |ت ا|، م| مح|ں، |بنی| ذر|ذری|ریع|ہوں| عل|تما|مام|ونک|نکہ|دان|پنی|ر ح| ام|من |عام|پور| طر|ے ع|ائد|بھی|ھی | مت| مق|د ا| خل|لاف|اعل|کوئ| لی|و ک|ے ی|ا ک|ر آ|دیو|اں |چون|، چ|یاس|برا|کرے|ی ع|ر ج","fas":" و | حق| با|که | که|ند | در|در |رد | دا|دار|از |هر | از|یت | هر|ر ک|حق |د ه|ای |ان |د و| را|ود |ین |یا |ارد|کس |ی و|را | یا| کس| بر|باش|د ک|ه ب| آز|آزا| خو|ه ا| اس|د ب|زاد|ار | آن|ق د|شد |حقو|قوق|ی ب|ه د|ده |وق |ید |ی ک|ر م|خود|ور |و ا|رای|اشد|ام |تما| اج|ری |ادی|س ح|دی |اید|است| ان|نه |و م|د ا|ر ا| بی|با |انه|ی ا|د، |ون | تا| هم| نم|ات |مای|ا ب|ایت|ر ب| بش| کن|انو|اسا| مر|ست | مو| مل|برا|وان|این|جتم| می|ورد| شو| ای|ن ا| اع| به|ت و|، ا|اجت|ماع|عی |ا م|ائی|ئی |و ب|نی |ملل|ت ا|و آ|آن |بشر| زن|ی، |کند|ن م|ن و|بای|شود|ی ی|های| من|شور| مس|کار|ت ب| بد|دان|اری|اعی|د آ|مل |ز آ|یگر|ی ر|ت م|مور| گر|گرد| مق|توا|ی م|علا|یه |ن ب|میت| شد| کش|کشو|ه و|ق م|د ش| مج| اح|ن ت|و د| حم|لی | کا|ت ک|هٔ |نون|مین|دیگ| عم|انی|ر خ|ه م| مت|ن ح|ی د|لام|رند|اه |نجا|بعی|نوا|ساس|ساو|د م| آم|ادا|وی |گی |هد |ا ک|اد |ی ح| مح| قا|قان|می |یده|مقا|لل |ر ش|ق و|اعل|ا د|شده|ع ا| بع|اسی|د ت|همه|سان|شر | عق|ر و|دگی|حما|ا ه|خوا|‌ها|ه‌ا| او|او |اده|اً |ر ت| دی|ومی| شر|نمی|بر | هی|هیچ|یر |ز ح|مند|بین|تی |جا |عقی|یتو|م و|مسا|و ت|سی |اوی|بهر|م م|ر د|انت|زش |ارن|زند|ندگ|و ه|رفت|رار|واه|ا ر| بو|تأ|أم|ٔمی|ران|عمو|موم|ی ن|اند|ل م|ردد|ه ح|عیت| فر| بم|دیه|ا ا|نما|آنج|کلی|احد|حدی|مال| تع|و ح|مرد|ت، |ملی|ق ا|واد|م ا|د د| خا| ار|اشن|شند","zlm":" دا|ان |دان| بر| او|ن س|له | ڤر|كن |ن ك|دال|ن ا|ن د|رڠ |حق |يڠ | كڤ|ارا| يڠ|أن |تيا|ڤد |ورڠ|ڠن |اله|ياڤ| تر|ولي|ن ڤ|اور|كڤد|برح|رحق|ين |ستي|اڤ |را |ليه| ات|ه ب| ست|يه |اتا| عد|عدا|ن ب|تاو|ڤ ا|او |ن ت|بيب|يبس|سي | كب|ه د|ن م| من| سو| سا| حق|ق ك|اسا|سام| تي|ن ي|الم|لم | اي|ن، |رن |اتو| ما|د س| با|باڬ|نڬا|ڬار| مم|كبي|بسن|سن |اين|ڠ ع|ڽ س|چار| سب|ي د|ندق|د ڤ|اڽ |اڬي|سبا| ڤم| د |نسي|ا ڤ|هن |قله|يند|تا |ي ا|ام | بو|ڬي | نڬ|اون|تن |وان|ا س|مأن|أنس|ڠ ب| كس| سم| سچ|سچا|ا ب|بول| مأ|سيا|ساس|اسي| ڤڠ|بڠس| دڠ|دڠن| ڤو|ڤا |ت د|رتا| هن|هند|دقل|ي م| اس|ادي|نڽ |ات |تره|رها|هاد|ادڤ| لا|تي |ڤرل|مان|، ك|بار|ارڠ|ق م|ڤون|ون |، د|اي |اول|ق٢ |٢ د|ڠسا|تو |يكن|وين|ن ه|اكن|يأن|وڠن|دڤ |وا |ا د|ن٢ |نتو|وق | سس|ماس|اس |ه م|مرا|ندو| ان| بي| مڠ|ڠ٢ |ائن|رات|يك |حق٢|برس|اد |ي س| كو|مڤو|ري | مل|وات|واس|ڤمب|، ت| سر|سرت|امر|سمو|اڬا|رلي|لين|دوڠ|ل د|تار|ڠ م|، س|وند|ي ك|لوا|سوا|ارك|تيك|ڤري|رسا|ياد|ريك|ا، |ونت|ڠ ت|ترم|ڤرا|سأن|اڤا|ي ڤ|ا ا| در|رأن| ڤن|سوس|ورو|ڠ س|لائ| بڠ|٢ ب|توق|دير|يري|وكن|جوا|هار|ندي|ارأ|وه |كرج|ڠڬو|ي، |موا| كأ|اجر|جرن| به|بها| مر|راس| كم|و ك|نن |ڤرك|ندڠ|دڠ٢|ا م| سڤ|ا٢ |سات|ق ا|ڤ٢ |شته|تها|سال|ينڠ|سسي|وهن|مول|منو|وبو| دل|وار|كور|د ك|ا ك| ڤل|لاج|ڠ ا|مبي|نتي|تيڠ|وسي|يال|ال |انت|نتا|بس |هڽ |ن ح|ه ا|كڤر|ڠ د|م س","skr":"تے |اں | تے|دے |دی |وں | دا| کو| حق|کوں|ے ا| دے|دا | دی|یاں| کی|ے ۔|یں |ہر | ۔ | ہے|ہے | وچ|کیت| ان|وچ | شخ|شخص|ال |ادی| حا|اصل| نا|ے م|خص |ں د|حق |حاص|صل |یا | ای|ل ہ|اتے|ق ح|ے و| ات|ں ک|سی |ہیں| مل|ی ت|نال| از|ازا|زاد| او|حقو|قوق|ار |ا ح| ۔ہ|۔ہر|ر ش|ے ج|ص ک|وق |دیا|نہ |یند|ندے| یا| کر|ئے | جو|کہی|ی د|انس|نسا|سان|وند|ی ا|یتے|و ڄ|ڻ د|یسی| وی|ا ا|ملک|ے ح|ے ک| ہو|ے ب|ں ا|ا و|ئی |ر ک|تی |آپڻ|وڻ |ندی| نہ|ویس| آپ| جی|اون| کن|انہ|ن ۔|جو |ی ن|ان | کہ|ری | تھ|ے ہ| ڄئ|۔ ا|ے ن|ی ۔|ڻے | ہر|ام |دہ |ں ت|ں و|ں م|تھی| من|کو |ی ح|کنو|نوں|ہاں| بچ|ے ت|رے |ون |ی ک|ور |ہکو|نی |یاد|ت د|یتا|ی ہ|نہا|ن د|اری|تا |لے |ڄئے|ے د| ہک| قو|پڻے|می |ی م|قوا|وام| ون|ق ت|اف |ل ک|اے | تع|ین |چ ا|خلا|ل ت|لک |ہو |ارے| و |انی|جیا|ے س| سا|ن ا|دار|یت |ی ج|ئو |ی و| اق|علا|کرڻ|ونڄ|ات | اے|ر ت|ق د|الا|ہوو| چا| رک|بچئ|چئو|وری| وس| لو| پو|پور|قنو|نون|ہ د|ے خ|ایہ|و ا|این| ڋو| خل|لاف|ڻ ک| جا| ۔ک| عز|عزت|ا ک| مع|ے ع|یر |قوم|ں آ|او |اد |ب د|ریا|مل |رکھ|وسی|سیب|یب |کاں| قن|اقو|رڻ |وئی|ں ج|ا ت|ل ا|زت |ت ت|ر ا| سی|لا |وے |ہی |ا م|ے ر|تعل|ں س| سم|یوڻ|ر ہ|ڻی |اوڻ|لوک|م م| مت|متح|تحد|حدہ|ایں| اع|ے ذ| جھ|جھی|کوئ|کار| کھ|ہ ا|ھین|م ت| کم| ہن|ہن |ی، |ں ب|د ا|سار|ن ک|علی|لیم|نڄے|ڄے |ی س|یہو|ھیو|ائد|و ک|ائی|ے ق| مط| سڱ|سڱد| ذر|ذری|ھیا|نے |کیو","pbu":" د | او|او |په | په| چې|چې | حق|ي ا|ره |ې د|نه |و ا|و د|ه ا|هر |ه و| څو|ه د|ري |حق |ي چ| کښ|څوک|وک |وي | شي|له |غه |کښې|ښې | سر| لر|لري|و پ|ه پ|ټول|لو |يت |سره|کړي|ي۔ه|ه ک|ي، |ر څ| ټو|ق ل| له|يا | هغ| از|۔هر|د م|ازا| کړ|دي |هغه| کو|نو |د ا|حقو|قوق|زاد|ه ت| پر| وا|ولو|خه |ه ه| وي| څخ|يو |ه م| يا|ول |د د|څخه| دي|ه ش|کول|ي د|ته |ه ب|ګه |و ي|ړي |اد |و م|ونو|شي۔|د ه|دې |خپل|واد| مل| هي| نه| تر| تو|د پ|ک ح|ې پ|ان |ولن|ني |ه ح|يوا|تون| با|ادي| هر| يو| مس|ي و|ې ا|لي |ې و|ي پ|د ت|يد |امي|وقو|شي |ړي۔|دان|انه|وګه| عم|هيو| دا| دغ|قو |ي۔ |ه چ|ار | خپ|بشر|توګ|اند|هغو|لني|باي|ايد| ده|ه ن|وي،|و ه|، د|ي ح| بر|غو | تا|ين |ايت| شو|شوي|دغه|مي |م د|دهغ| من|و ح| لا| ډو|ډول|بعي|پل | بش| ته|اوي|ه ګ|د ب|نيز|پر |ده |و ت|انو|نون|ون |ومي|رو |هيڅ|يڅ |ي ت|علا|ه ي|ه ل|وم |کار|ساو|تر |وند|ونه|يه |ن ک|مين|موم|و ک|اتو| اع|اعل|لام|اره| ځا|مسا| ان|د ټ|ټه | ګټ|ي ش| بي| مح|قان| پي|و ر|اخل|تو |اسي|سي | وک|ديو|ځاي|عقي| ور|لان|ل ت|ه س|ې چ| وس|و س|وون| ژو|ژون|يز |وکړ|کي |ن ش|ندې|ک د| اس| قا| نو|عمو|لتو|و ب|پار|ولے|لے |ې ک| عق|۔هي|څ څ| را|بل | بل|وسي|ت ا|ر د| ار| هم|هم |دو |ي م|مان|اسا|رته|شري|ا د|ر م|ښوو| رو|ګټه| غو|ونک| وړ|مل | شخ|شخص| اج|د ق|تام|وق |ملت|و ن|من |و څ|ا ب|ن ا|قيد| چا|ل ه| تب|تبع|ر پ|حما| کا|د خ|ر س|اني|نځ "},"Devanagari":{"hin":"के |प्र| के| और|और |ों | का|कार| प्|का | को|ं क|या |ति |ार |को | है|िका|ने |है |्रत| अध|धिक|की |अधि|ा क| कि| की| सम|ें |व्य|्ति|क्त|से | व्|्यक|ा अ|में|मान|ि क| स्| मे|सी |न्त|े क| हो|ता |यक्|ै ।|क्ष|त्य|िक | कर| या|्य |भी | वि|रत्|ी स| जा|र स|्ये|येक|ेक |रों|स्व|िया|ा ज|त्र|क व|र ह| अन|्रा|ित |किस|ा स|िसी|ा ह| से|ना |र क| पर| सा|गा |देश| । | अप|ान |समा|्त |े स|्त्|ी क|ा प| ।प|वार| रा|न क|षा |अन्|।प्|था |ष्ट| मा|्षा|्वा|ारो|तन्| इस|े अ|ाप्|प्त|राष|ाष्|्ट्|ट्र|्वत|वतन| उस|राप|त ह|कि | सं|ं औ|हो | दे|किय|ा ।|े प|ार्| भी|करन| न |री |र अ|जाए|क स|ी प|िवा|सभी|्तर|अपन| नि| तथ|तथा|रा |यों|े व|ाओं|ओं |पर |सम्|्री|ीय |सके|व क| द्|द्व|ारा|िए | ऐस|रता| सभ|िक्|ो स|रक्|र प|माज|्या|होग|र उ|ा व|रने| जि|ं म|े म|ाव |ाएग| भा|पने| लि|स्थ|पूर|इस |त क|ाने|रूप|भाव|लिए|े ल|कृत|र्व|ा औ|ो प|द्ध| घो|घोष|श्य|ेश |। इ| रू|ूप |एगा|शिक|े ब|दी | उन|रीय|रति|ूर्|न्य|्ध |णा |ी र|ं स|र्य|य क|परा| पा|े औ|ी अ|ेशो|शों|ानव|ियो|म क| शि| सु|तर्|जो |्र |तिक|सार|चित| पू|ी भ|जिस|ा उ|दिय|राध|चार|र द|विश|स्त|ारी|परि| जन|वाह|नव | बु|म्म|ले |्म |र्ण| जो|ानू|नून|िश्|गी |साम|ोगा|रका|्रो|ोषण|षणा|ाना|ो क|े य| यह|चूं|ूंक|ंकि|अपर|कोई|ोई |ाह |ी म| ।क|ी न|ा ग|ध क|े ज|न स|बन्|निय|याद|ादी|्मा| सद|जीव|हित|य ह|कर |ास |ी ज|ाज |ं न|्था|ामा|कता","mar":"्या|या |त्य|याच|चा | व |ण्य|प्र|कार|ाचा| प्|धिक|िका| अध|च्य|अधि|ार | आह|आहे|हे |ा अ| स्|्रत|स्व|्ये|ा क| कर|्वा|ता |ास | त्|ा स|त्र|ा व|िक |यां|ांच|वा |मान| या|्य | अस| का|रत्|ष्ट|येक|ल्य|र्य|र आ|ाहि|क्ष| सं| को|कोण|ामा|ाच्|ात | रा|ा न|ेका| सा|ून |ंत्| मा|चे |तंत|राष|ाष्|्ट्|ट्र|ने |े स|वात|करण| कि|किं|िंव|ंवा|व्य|ा प|कास|ना | मि| सम|क्त|ये |मिळ|समा|र्व|ातं|्र्|े प| जा|यास|व स|ोणत|ीय |ा आ|रण्|काम| दे|ांन|े क|ा म|रां| व्|्यक|हि |ान | पा|्षण|िळण| आप|ार्|ही |े अ|ा द|ली |ळण्|े व|ची | आण|ंच्| वि|ारा|्रा|ाही|मा |ा ह|द्ध|्री| नि|णे |ला | सर|सर्| नय|नये|ाचे|ी अ|्व |ंना|षण |आपल|ले |माज|बंध|ी प|्त |त क|लेल| हो|ील | शि|शिक|ध्य|ी स|आणि|णि |े ज|देश|न क|ानव|पाह|हिज|िजे|जे |रीय|क स|व त|यक्|ा ज|यात|िक्|त स|े आ|रक्|पल्|वी |संब|ंबं|न्य| ज्|ज्य|स्थ| के|्वत|असल| उप|य अ|क व|त्व|ीत |त व|केल|ाने|य क|णत्|ासा|रति|भाव|े त|व म|ेण्|िष्|साम|क आ|सार|कां|याय|साठ|ाठी|ठी |े य|ंचा|करत|रता|र व|्ती|ीने|याह|र्थ|च्छ|ी आ|स स|ोणा|संर|ंरक|त आ|ंधा|ायद|ी व|ेशा|ित | अश|जाह|हीर|तील|ा ब| अथ|अथव|थवा|ी म|स्त|ा त|ती |नवी|ाची|िवा|देण|याव|ांत|ण म|व आ|य व| हक|हक्|क्क|ा य|ेत |वस्|पूर|ूर्|ारण|द्य|ंचे|ेले|ेल्|कृत|शा |तीन| अर|अर्|्थी|थी |्रद|राध|यत्|ाला|तिष|ष्ठ|श्र|ण स|रून| आल|्ध |सले|े म| शा|्रक|रका|तिक|ाजि|जिक|्क |ाजा| इत|इतर|तो |साध","mai":"ाक |प्र|कार|धिक|िका|ार | आʼ|आʼ |्रत|ेँ |्यक|क अ|िक |्ति| अध|व्य|अधि|क स| प्| व्|क्त|केँ|यक्|तिक|हि | स्|न्त|क व|मे |बाक| सम|मान|त्य|क्ष| छै|छैक|ेक |रत्|स्व|त्र|्ये|येक| अप|ष्ट|सँ |र छ|ैक।| वि| एह|वा |ित |ति |िके|ट्र| जा|्त्|राष|ाष्|्ट्| हो| सा| रा|्य | अन|अपन| कर|।प्|कोन| अछ|अछि|क आ|्वत|वतन|तन्| पर|था | को| वा|ताक|ार्|एहि|पन |ा आ|नहि| मा|्री|समा|नो |रता| दे|्षा|रक |देश|क प| नि| नह| कए| का|छि |न्य|्त |ि क| सं|ोनो| तथ|तथा|्वा|ारक|ान्|ल ज|ा स|ान |िवा|क ह|ीय |र आ| आ |्या|ँ क|वार|ता |ना |जाए| जे|करब| एक| आओ|आओर|ओर |ानव|परि|ँ अ|रीय|ा प|धार|ारण|स्थ|माज|साम|ामा|्रस|र्व|कएल|घोष|अन्|्तर|त क|स्त| सभ|्रा|रण |ँ स|द्ध|एबा|नक |ा अ|िक्|षा |रक्|क।प|ʼ स|चित|पूर|ʼ अ|यक |ाहि|रबा|क ज|कर | घो|ोषण|सम्|र प| हे|हेत|ेतु|तु |शिक|त अ| उप| अव|ूर्|एल |िमे|एहन|हन |षणा|ाधि|सभ |च्छ|अनु| शि|ेल |रूप|क क|भाव|प्त|्ध |ि ज|वक | सक|र अ|रति|निर|िर्|जाह|हो |ँ ए|े स|होए|चार|ण स|र्य|ि आ|सभक|्रक|ाजि|जिक|ाप्|र्ण|त स|क उ|रा |त आ|एत।|त ह| जन|ैक |विव|ोएत|वाध|क ब|री |न प| भा|य आ|राप| ओ |न व|ʼ प|्ण |न अ|कृत|िश्|ा व|कान|ारा|ि स|हु |रसं| उद|उद्|श्य|ाएत|िसँ|जे |ि घ|जेँ| कि|कि |ेश |केओ|ेओ |त्त|सार|क ए|रिव|वास|य प|्थि|विश|ओ व|यता|पर | भे|क ल|नवा| बी| सह|िष्|ि द| रू| ले| पए|पएब| अथ|अथव|थवा|क र|न स|हिम|ास |ए स|ि अ| दो|षाक| पू| द्|द्व|धक ","bho":" के|के |ार |े क|कार|धिक|िका|ओर | आओ|आओर| अध|अधि|े स|ा क|े अ| सं|र क| हो| मे|में|ें |र स|िक | कर|र ह|ा स| से|मान| सम|न क|रा |से |क्ष|े ब|नो |वे | चा|ता |्रा| रा|ति |खे |चाह|ष्ट| सा|राष|ाष्|प्र| का| मा|्ट्|ट्र|े आ| प्| सक| स्| जा| बा|पन |था |त क|ि क|कौन|ौनो|करे|होख| कौ|ेला|्त |ाति|ला |तथा| आप| ओक|आपन|रे |र म| तथ|सबह| हव|हवे|र आ|कर |ोखे|जा |े ओ|तिर|िर |बहि| ह।|ही |सके|केल|ना |हे | और|त्र|ान | खा|खात|।सब| पर|े म|े च|ा आ|षा |ावे|र ब|न स|ओकर|ी क| लो|ाहे|ल ज| सब|्षा|संग|ं क|ित |माज|मिल|े ज|रक्|हिं|िं |ा प|वे।|े ह|ाज |और |स्व|ंत्|ला।|ो स| नइ|नइख|इखे|हु |ानव|िया|्र |लोग|क स|समा|कान|क्त| जे|करा|्रत|े। | ओ |ी स|े न|्री|रीय|पर |े उ|ाही|ानू|नून|स्थ|े व|ाम |्वत|वतं|तंत|रता|केह|या |े ख|। स| सु|प्त| दे|े त|साम|र अ|ीय |र प|बा।|ा।स|सभे|भे | वि|योग|दी | आद|ून |ा म|्य |व्य|ए क|ेहु| या|री |र न| बि|राप|ाप्|ु क| मि|यता|आदि|दिम|मी |नवा|ाधि|े द|चार|ले | नि| पा|ोग | ही| दो|ादी|हि |तिक|पूर| इ |ा ह|्ति|ल ह|खल |ाव | अप| सभ|िमी|देश|ुक्| सह|शिक|िक्|ि म|जे |षण |ाजि|जिक|क आ|्तर|े प| उप|जाद|े भ|्या| जर|म क|ेकर| अं|े र|।के|न आ|सब |साथ|ंगठ|गठन|ठन |रो | जी|ा। |्म |ी ब|हो |न ह|े ल|न म|वाध|निय|ेश | शि|ज क| ले|ने |बा |संर|ंरक|्षण|ामा|य क|ास |उपय|पयो|दोस| आज|आजा| भी| उच|चित|र व| पू| घो|घोष| व्| शा|िल |ा।क| कई| को|होए|्थि","nep":"को | र |कार|प्र|ार |ने |िका|क्त|्यक|धिक|व्य| गर| प्|्रत|अधि|्ति| अध| व्|यक्|मा |िक |ाई |त्य|न्त|लाई|मान| सम|त्र|गर्|र्न|क व|्ने| वा|वा | स्|रत्|र स|्ये|येक|ेक |छ ।|तिल|हरू|क्ष|ो स| वि|ा स|्त्|िला| । |स्व|हुन|ति | हु| मा| रा|ले |र छ| छ |ष्ट|समा|वतन|तन्|्ट्|ट्र| सं|ो अ|राष|ाष्|्वत|नेछ|ुने|ान |े अ|ता | का|्र |हरु|गरि|ाको|िने| अन|ना | नि|े छ| सा|क स|तिक|ित |नै |र र|रता|रू |था |ा र|कुन|ुनै|ा अ|स्त|्त | छै|छैन| तथ|तथा|ा प|ार्|वार| पर|ा व|एको|्षा|परि|रक्|। प|माज|रु |द्ध|का |्या|ो प|ामा|्रा|सको|ेछ | ला|धार|नि |ाहर|देश| यस|र ह|िवा|सबै|र म|भाव|्य |र व|रहर|रको|न अ|सम्|े र|संर|ंरक|अन्|ताक|्रि|्वा|ा भ|त र| कु| त्|री |ो व|न स|रिन|लाग|ारक|ानव| सब| शि|शिक|िक्|ै व|रिय|रा |ा न|पनि|ारा|श्य|ा त|्यस|यस्|ाउन|्न | अप|चार|ाव | भए|ारम| सु|ुद्|षा |ि र|रूक| सह|बाट|्षण|साम|्तर|िय |रति|ो आ|र प|ो ल|कान|द्व|ुक्|ान्| उप|द्द|ुन |ैन |ेछ।|ैन।|ारह| भे|ागि|गि |निज|वाह|्ध |र्य| आध|रमा|ा म|नको|बै |न ग|ाट |।प्|ाजि|जिक|त्प|िको|ाय |र त|ात्| उस|ूर्| अभ| अर|जको|स्थ| आव|त स|ित्| पन|िएक|्तो|तो | पा|ा ग| भन|ानु|परा|राध| छ।| मत|अपर|भेद|ि स|रुद|ो ह|रिव|रका|न्य| जन|यता|े स|र्म|ारी| दि|क अ|नमा|ूको|हित|ा क|क र|र अ|ा ब|उसक|पूर|त्व|र्द|सार|णको|युक|।कु|विध| घो|घोष| सक|भएक|नुन|्यह|ि व|ो भ| पु| मन|नी |विच| दे|राज|विर|िरु|काम|र न|यहर|िश्"}};

/***/ }),

/***/ 87:
/***/ (function(module) {

module.exports = require("os");

/***/ }),

/***/ 94:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedProtocolError = exports.ReadError = exports.TimeoutError = exports.UploadError = exports.CacheError = exports.HTTPError = exports.MaxRedirectsError = exports.RequestError = exports.setNonEnumerableProperties = exports.knownHookEvents = exports.withoutBody = exports.kIsNormalizedAlready = void 0;
const util_1 = __webpack_require__(669);
const stream_1 = __webpack_require__(413);
const fs_1 = __webpack_require__(747);
const url_1 = __webpack_require__(835);
const http = __webpack_require__(605);
const http_1 = __webpack_require__(605);
const https = __webpack_require__(211);
const http_timer_1 = __webpack_require__(97);
const cacheable_lookup_1 = __webpack_require__(286);
const CacheableRequest = __webpack_require__(116);
const decompressResponse = __webpack_require__(391);
// @ts-expect-error Missing types
const http2wrapper = __webpack_require__(645);
const lowercaseKeys = __webpack_require__(662);
const is_1 = __webpack_require__(678);
const get_body_size_1 = __webpack_require__(564);
const is_form_data_1 = __webpack_require__(813);
const proxy_events_1 = __webpack_require__(21);
const timed_out_1 = __webpack_require__(454);
const url_to_options_1 = __webpack_require__(26);
const options_to_url_1 = __webpack_require__(909);
const weakable_map_1 = __webpack_require__(288);
const get_buffer_1 = __webpack_require__(500);
const dns_ip_version_1 = __webpack_require__(993);
const is_response_ok_1 = __webpack_require__(298);
const deprecation_warning_1 = __webpack_require__(397);
const normalize_arguments_1 = __webpack_require__(48);
const calculate_retry_delay_1 = __webpack_require__(462);
const globalDnsCache = new cacheable_lookup_1.default();
const kRequest = Symbol('request');
const kResponse = Symbol('response');
const kResponseSize = Symbol('responseSize');
const kDownloadedSize = Symbol('downloadedSize');
const kBodySize = Symbol('bodySize');
const kUploadedSize = Symbol('uploadedSize');
const kServerResponsesPiped = Symbol('serverResponsesPiped');
const kUnproxyEvents = Symbol('unproxyEvents');
const kIsFromCache = Symbol('isFromCache');
const kCancelTimeouts = Symbol('cancelTimeouts');
const kStartedReading = Symbol('startedReading');
const kStopReading = Symbol('stopReading');
const kTriggerRead = Symbol('triggerRead');
const kBody = Symbol('body');
const kJobs = Symbol('jobs');
const kOriginalResponse = Symbol('originalResponse');
const kRetryTimeout = Symbol('retryTimeout');
exports.kIsNormalizedAlready = Symbol('isNormalizedAlready');
const supportsBrotli = is_1.default.string(process.versions.brotli);
exports.withoutBody = new Set(['GET', 'HEAD']);
exports.knownHookEvents = [
    'init',
    'beforeRequest',
    'beforeRedirect',
    'beforeError',
    'beforeRetry',
    // Promise-Only
    'afterResponse'
];
function validateSearchParameters(searchParameters) {
    // eslint-disable-next-line guard-for-in
    for (const key in searchParameters) {
        const value = searchParameters[key];
        if (!is_1.default.string(value) && !is_1.default.number(value) && !is_1.default.boolean(value) && !is_1.default.null_(value) && !is_1.default.undefined(value)) {
            throw new TypeError(`The \`searchParams\` value '${String(value)}' must be a string, number, boolean or null`);
        }
    }
}
function isClientRequest(clientRequest) {
    return is_1.default.object(clientRequest) && !('statusCode' in clientRequest);
}
const cacheableStore = new weakable_map_1.default();
const waitForOpenFile = async (file) => new Promise((resolve, reject) => {
    const onError = (error) => {
        reject(error);
    };
    // Node.js 12 has incomplete types
    if (!file.pending) {
        resolve();
    }
    file.once('error', onError);
    file.once('ready', () => {
        file.off('error', onError);
        resolve();
    });
});
const redirectCodes = new Set([300, 301, 302, 303, 304, 307, 308]);
const nonEnumerableProperties = [
    'context',
    'body',
    'json',
    'form'
];
exports.setNonEnumerableProperties = (sources, to) => {
    // Non enumerable properties shall not be merged
    const properties = {};
    for (const source of sources) {
        if (!source) {
            continue;
        }
        for (const name of nonEnumerableProperties) {
            if (!(name in source)) {
                continue;
            }
            properties[name] = {
                writable: true,
                configurable: true,
                enumerable: false,
                // @ts-expect-error TS doesn't see the check above
                value: source[name]
            };
        }
    }
    Object.defineProperties(to, properties);
};
/**
An error to be thrown when a request fails.
Contains a `code` property with error class code, like `ECONNREFUSED`.
*/
class RequestError extends Error {
    constructor(message, error, self) {
        var _a;
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = 'RequestError';
        this.code = error.code;
        if (self instanceof Request) {
            Object.defineProperty(this, 'request', {
                enumerable: false,
                value: self
            });
            Object.defineProperty(this, 'response', {
                enumerable: false,
                value: self[kResponse]
            });
            Object.defineProperty(this, 'options', {
                // This fails because of TS 3.7.2 useDefineForClassFields
                // Ref: https://github.com/microsoft/TypeScript/issues/34972
                enumerable: false,
                value: self.options
            });
        }
        else {
            Object.defineProperty(this, 'options', {
                // This fails because of TS 3.7.2 useDefineForClassFields
                // Ref: https://github.com/microsoft/TypeScript/issues/34972
                enumerable: false,
                value: self
            });
        }
        this.timings = (_a = this.request) === null || _a === void 0 ? void 0 : _a.timings;
        // Recover the original stacktrace
        if (!is_1.default.undefined(error.stack)) {
            const indexOfMessage = this.stack.indexOf(this.message) + this.message.length;
            const thisStackTrace = this.stack.slice(indexOfMessage).split('\n').reverse();
            const errorStackTrace = error.stack.slice(error.stack.indexOf(error.message) + error.message.length).split('\n').reverse();
            // Remove duplicated traces
            while (errorStackTrace.length !== 0 && errorStackTrace[0] === thisStackTrace[0]) {
                thisStackTrace.shift();
            }
            this.stack = `${this.stack.slice(0, indexOfMessage)}${thisStackTrace.reverse().join('\n')}${errorStackTrace.reverse().join('\n')}`;
        }
    }
}
exports.RequestError = RequestError;
/**
An error to be thrown when the server redirects you more than ten times.
Includes a `response` property.
*/
class MaxRedirectsError extends RequestError {
    constructor(request) {
        super(`Redirected ${request.options.maxRedirects} times. Aborting.`, {}, request);
        this.name = 'MaxRedirectsError';
    }
}
exports.MaxRedirectsError = MaxRedirectsError;
/**
An error to be thrown when the server response code is not 2xx nor 3xx if `options.followRedirect` is `true`, but always except for 304.
Includes a `response` property.
*/
class HTTPError extends RequestError {
    constructor(response) {
        super(`Response code ${response.statusCode} (${response.statusMessage})`, {}, response.request);
        this.name = 'HTTPError';
    }
}
exports.HTTPError = HTTPError;
/**
An error to be thrown when a cache method fails.
For example, if the database goes down or there's a filesystem error.
*/
class CacheError extends RequestError {
    constructor(error, request) {
        super(error.message, error, request);
        this.name = 'CacheError';
    }
}
exports.CacheError = CacheError;
/**
An error to be thrown when the request body is a stream and an error occurs while reading from that stream.
*/
class UploadError extends RequestError {
    constructor(error, request) {
        super(error.message, error, request);
        this.name = 'UploadError';
    }
}
exports.UploadError = UploadError;
/**
An error to be thrown when the request is aborted due to a timeout.
Includes an `event` and `timings` property.
*/
class TimeoutError extends RequestError {
    constructor(error, timings, request) {
        super(error.message, error, request);
        this.name = 'TimeoutError';
        this.event = error.event;
        this.timings = timings;
    }
}
exports.TimeoutError = TimeoutError;
/**
An error to be thrown when reading from response stream fails.
*/
class ReadError extends RequestError {
    constructor(error, request) {
        super(error.message, error, request);
        this.name = 'ReadError';
    }
}
exports.ReadError = ReadError;
/**
An error to be thrown when given an unsupported protocol.
*/
class UnsupportedProtocolError extends RequestError {
    constructor(options) {
        super(`Unsupported protocol "${options.url.protocol}"`, {}, options);
        this.name = 'UnsupportedProtocolError';
    }
}
exports.UnsupportedProtocolError = UnsupportedProtocolError;
const proxiedRequestEvents = [
    'socket',
    'connect',
    'continue',
    'information',
    'upgrade',
    'timeout'
];
class Request extends stream_1.Duplex {
    constructor(url, options = {}, defaults) {
        super({
            // This must be false, to enable throwing after destroy
            // It is used for retry logic in Promise API
            autoDestroy: false,
            // It needs to be zero because we're just proxying the data to another stream
            highWaterMark: 0
        });
        this[kDownloadedSize] = 0;
        this[kUploadedSize] = 0;
        this.requestInitialized = false;
        this[kServerResponsesPiped] = new Set();
        this.redirects = [];
        this[kStopReading] = false;
        this[kTriggerRead] = false;
        this[kJobs] = [];
        this.retryCount = 0;
        // TODO: Remove this when targeting Node.js >= 12
        this._progressCallbacks = [];
        const unlockWrite = () => this._unlockWrite();
        const lockWrite = () => this._lockWrite();
        this.on('pipe', (source) => {
            source.prependListener('data', unlockWrite);
            source.on('data', lockWrite);
            source.prependListener('end', unlockWrite);
            source.on('end', lockWrite);
        });
        this.on('unpipe', (source) => {
            source.off('data', unlockWrite);
            source.off('data', lockWrite);
            source.off('end', unlockWrite);
            source.off('end', lockWrite);
        });
        this.on('pipe', source => {
            if (source instanceof http_1.IncomingMessage) {
                this.options.headers = {
                    ...source.headers,
                    ...this.options.headers
                };
            }
        });
        const { json, body, form } = options;
        if (json || body || form) {
            this._lockWrite();
        }
        if (exports.kIsNormalizedAlready in options) {
            this.options = options;
        }
        else {
            try {
                // @ts-expect-error Common TypeScript bug saying that `this.constructor` is not accessible
                this.options = this.constructor.normalizeArguments(url, options, defaults);
            }
            catch (error) {
                // TODO: Move this to `_destroy()`
                if (is_1.default.nodeStream(options.body)) {
                    options.body.destroy();
                }
                this.destroy(error);
                return;
            }
        }
        (async () => {
            var _a;
            try {
                if (this.options.body instanceof fs_1.ReadStream) {
                    await waitForOpenFile(this.options.body);
                }
                const { url: normalizedURL } = this.options;
                if (!normalizedURL) {
                    throw new TypeError('Missing `url` property');
                }
                this.requestUrl = normalizedURL.toString();
                decodeURI(this.requestUrl);
                await this._finalizeBody();
                await this._makeRequest();
                if (this.destroyed) {
                    (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.destroy();
                    return;
                }
                // Queued writes etc.
                for (const job of this[kJobs]) {
                    job();
                }
                // Prevent memory leak
                this[kJobs].length = 0;
                this.requestInitialized = true;
            }
            catch (error) {
                if (error instanceof RequestError) {
                    this._beforeError(error);
                    return;
                }
                // This is a workaround for https://github.com/nodejs/node/issues/33335
                if (!this.destroyed) {
                    this.destroy(error);
                }
            }
        })();
    }
    static normalizeArguments(url, options, defaults) {
        var _a, _b, _c, _d, _e;
        const rawOptions = options;
        if (is_1.default.object(url) && !is_1.default.urlInstance(url)) {
            options = { ...defaults, ...url, ...options };
        }
        else {
            if (url && options && options.url !== undefined) {
                throw new TypeError('The `url` option is mutually exclusive with the `input` argument');
            }
            options = { ...defaults, ...options };
            if (url !== undefined) {
                options.url = url;
            }
            if (is_1.default.urlInstance(options.url)) {
                options.url = new url_1.URL(options.url.toString());
            }
        }
        // TODO: Deprecate URL options in Got 12.
        // Support extend-specific options
        if (options.cache === false) {
            options.cache = undefined;
        }
        if (options.dnsCache === false) {
            options.dnsCache = undefined;
        }
        // Nice type assertions
        is_1.assert.any([is_1.default.string, is_1.default.undefined], options.method);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.headers);
        is_1.assert.any([is_1.default.string, is_1.default.urlInstance, is_1.default.undefined], options.prefixUrl);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.cookieJar);
        is_1.assert.any([is_1.default.object, is_1.default.string, is_1.default.undefined], options.searchParams);
        is_1.assert.any([is_1.default.object, is_1.default.string, is_1.default.undefined], options.cache);
        is_1.assert.any([is_1.default.object, is_1.default.number, is_1.default.undefined], options.timeout);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.context);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.hooks);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.decompress);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.ignoreInvalidCookies);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.followRedirect);
        is_1.assert.any([is_1.default.number, is_1.default.undefined], options.maxRedirects);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.throwHttpErrors);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.http2);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.allowGetBody);
        is_1.assert.any([is_1.default.string, is_1.default.undefined], options.localAddress);
        is_1.assert.any([dns_ip_version_1.isDnsLookupIpVersion, is_1.default.undefined], options.dnsLookupIpVersion);
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.https);
        is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.rejectUnauthorized);
        if (options.https) {
            is_1.assert.any([is_1.default.boolean, is_1.default.undefined], options.https.rejectUnauthorized);
            is_1.assert.any([is_1.default.function_, is_1.default.undefined], options.https.checkServerIdentity);
            is_1.assert.any([is_1.default.string, is_1.default.object, is_1.default.array, is_1.default.undefined], options.https.certificateAuthority);
            is_1.assert.any([is_1.default.string, is_1.default.object, is_1.default.array, is_1.default.undefined], options.https.key);
            is_1.assert.any([is_1.default.string, is_1.default.object, is_1.default.array, is_1.default.undefined], options.https.certificate);
            is_1.assert.any([is_1.default.string, is_1.default.undefined], options.https.passphrase);
            is_1.assert.any([is_1.default.string, is_1.default.buffer, is_1.default.array, is_1.default.undefined], options.https.pfx);
        }
        is_1.assert.any([is_1.default.object, is_1.default.undefined], options.cacheOptions);
        // `options.method`
        if (is_1.default.string(options.method)) {
            options.method = options.method.toUpperCase();
        }
        else {
            options.method = 'GET';
        }
        // `options.headers`
        if (options.headers === (defaults === null || defaults === void 0 ? void 0 : defaults.headers)) {
            options.headers = { ...options.headers };
        }
        else {
            options.headers = lowercaseKeys({ ...(defaults === null || defaults === void 0 ? void 0 : defaults.headers), ...options.headers });
        }
        // Disallow legacy `url.Url`
        if ('slashes' in options) {
            throw new TypeError('The legacy `url.Url` has been deprecated. Use `URL` instead.');
        }
        // `options.auth`
        if ('auth' in options) {
            throw new TypeError('Parameter `auth` is deprecated. Use `username` / `password` instead.');
        }
        // `options.searchParams`
        if ('searchParams' in options) {
            if (options.searchParams && options.searchParams !== (defaults === null || defaults === void 0 ? void 0 : defaults.searchParams)) {
                let searchParameters;
                if (is_1.default.string(options.searchParams) || (options.searchParams instanceof url_1.URLSearchParams)) {
                    searchParameters = new url_1.URLSearchParams(options.searchParams);
                }
                else {
                    validateSearchParameters(options.searchParams);
                    searchParameters = new url_1.URLSearchParams();
                    // eslint-disable-next-line guard-for-in
                    for (const key in options.searchParams) {
                        const value = options.searchParams[key];
                        if (value === null) {
                            searchParameters.append(key, '');
                        }
                        else if (value !== undefined) {
                            searchParameters.append(key, value);
                        }
                    }
                }
                // `normalizeArguments()` is also used to merge options
                (_a = defaults === null || defaults === void 0 ? void 0 : defaults.searchParams) === null || _a === void 0 ? void 0 : _a.forEach((value, key) => {
                    // Only use default if one isn't already defined
                    if (!searchParameters.has(key)) {
                        searchParameters.append(key, value);
                    }
                });
                options.searchParams = searchParameters;
            }
        }
        // `options.username` & `options.password`
        options.username = (_b = options.username) !== null && _b !== void 0 ? _b : '';
        options.password = (_c = options.password) !== null && _c !== void 0 ? _c : '';
        // `options.prefixUrl` & `options.url`
        if (is_1.default.undefined(options.prefixUrl)) {
            options.prefixUrl = (_d = defaults === null || defaults === void 0 ? void 0 : defaults.prefixUrl) !== null && _d !== void 0 ? _d : '';
        }
        else {
            options.prefixUrl = options.prefixUrl.toString();
            if (options.prefixUrl !== '' && !options.prefixUrl.endsWith('/')) {
                options.prefixUrl += '/';
            }
        }
        if (is_1.default.string(options.url)) {
            if (options.url.startsWith('/')) {
                throw new Error('`input` must not start with a slash when using `prefixUrl`');
            }
            options.url = options_to_url_1.default(options.prefixUrl + options.url, options);
        }
        else if ((is_1.default.undefined(options.url) && options.prefixUrl !== '') || options.protocol) {
            options.url = options_to_url_1.default(options.prefixUrl, options);
        }
        if (options.url) {
            if ('port' in options) {
                delete options.port;
            }
            // Make it possible to change `options.prefixUrl`
            let { prefixUrl } = options;
            Object.defineProperty(options, 'prefixUrl', {
                set: (value) => {
                    const url = options.url;
                    if (!url.href.startsWith(value)) {
                        throw new Error(`Cannot change \`prefixUrl\` from ${prefixUrl} to ${value}: ${url.href}`);
                    }
                    options.url = new url_1.URL(value + url.href.slice(prefixUrl.length));
                    prefixUrl = value;
                },
                get: () => prefixUrl
            });
            // Support UNIX sockets
            let { protocol } = options.url;
            if (protocol === 'unix:') {
                protocol = 'http:';
                options.url = new url_1.URL(`http://unix${options.url.pathname}${options.url.search}`);
            }
            // Set search params
            if (options.searchParams) {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                options.url.search = options.searchParams.toString();
            }
            // Protocol check
            if (protocol !== 'http:' && protocol !== 'https:') {
                throw new UnsupportedProtocolError(options);
            }
            // Update `username`
            if (options.username === '') {
                options.username = options.url.username;
            }
            else {
                options.url.username = options.username;
            }
            // Update `password`
            if (options.password === '') {
                options.password = options.url.password;
            }
            else {
                options.url.password = options.password;
            }
        }
        // `options.cookieJar`
        const { cookieJar } = options;
        if (cookieJar) {
            let { setCookie, getCookieString } = cookieJar;
            is_1.assert.function_(setCookie);
            is_1.assert.function_(getCookieString);
            /* istanbul ignore next: Horrible `tough-cookie` v3 check */
            if (setCookie.length === 4 && getCookieString.length === 0) {
                setCookie = util_1.promisify(setCookie.bind(options.cookieJar));
                getCookieString = util_1.promisify(getCookieString.bind(options.cookieJar));
                options.cookieJar = {
                    setCookie,
                    getCookieString: getCookieString
                };
            }
        }
        // `options.cache`
        const { cache } = options;
        if (cache) {
            if (!cacheableStore.has(cache)) {
                cacheableStore.set(cache, new CacheableRequest(((requestOptions, handler) => {
                    const result = requestOptions[kRequest](requestOptions, handler);
                    // TODO: remove this when `cacheable-request` supports async request functions.
                    if (is_1.default.promise(result)) {
                        // @ts-expect-error
                        // We only need to implement the error handler in order to support HTTP2 caching.
                        // The result will be a promise anyway.
                        result.once = (event, handler) => {
                            if (event === 'error') {
                                result.catch(handler);
                            }
                            else if (event === 'abort') {
                                // The empty catch is needed here in case when
                                // it rejects before it's `await`ed in `_makeRequest`.
                                (async () => {
                                    try {
                                        const request = (await result);
                                        request.once('abort', handler);
                                    }
                                    catch (_a) { }
                                })();
                            }
                            else {
                                /* istanbul ignore next: safety check */
                                throw new Error(`Unknown HTTP2 promise event: ${event}`);
                            }
                            return result;
                        };
                    }
                    return result;
                }), cache));
            }
        }
        // `options.cacheOptions`
        options.cacheOptions = { ...options.cacheOptions };
        // `options.dnsCache`
        if (options.dnsCache === true) {
            options.dnsCache = globalDnsCache;
        }
        else if (!is_1.default.undefined(options.dnsCache) && !options.dnsCache.lookup) {
            throw new TypeError(`Parameter \`dnsCache\` must be a CacheableLookup instance or a boolean, got ${is_1.default(options.dnsCache)}`);
        }
        // `options.timeout`
        if (is_1.default.number(options.timeout)) {
            options.timeout = { request: options.timeout };
        }
        else if (defaults && options.timeout !== defaults.timeout) {
            options.timeout = {
                ...defaults.timeout,
                ...options.timeout
            };
        }
        else {
            options.timeout = { ...options.timeout };
        }
        // `options.context`
        if (!options.context) {
            options.context = {};
        }
        // `options.hooks`
        const areHooksDefault = options.hooks === (defaults === null || defaults === void 0 ? void 0 : defaults.hooks);
        options.hooks = { ...options.hooks };
        for (const event of exports.knownHookEvents) {
            if (event in options.hooks) {
                if (is_1.default.array(options.hooks[event])) {
                    // See https://github.com/microsoft/TypeScript/issues/31445#issuecomment-576929044
                    options.hooks[event] = [...options.hooks[event]];
                }
                else {
                    throw new TypeError(`Parameter \`${event}\` must be an Array, got ${is_1.default(options.hooks[event])}`);
                }
            }
            else {
                options.hooks[event] = [];
            }
        }
        if (defaults && !areHooksDefault) {
            for (const event of exports.knownHookEvents) {
                const defaultHooks = defaults.hooks[event];
                if (defaultHooks.length > 0) {
                    // See https://github.com/microsoft/TypeScript/issues/31445#issuecomment-576929044
                    options.hooks[event] = [
                        ...defaults.hooks[event],
                        ...options.hooks[event]
                    ];
                }
            }
        }
        // DNS options
        if ('family' in options) {
            deprecation_warning_1.default('"options.family" was never documented, please use "options.dnsLookupIpVersion"');
        }
        // HTTPS options
        if (defaults === null || defaults === void 0 ? void 0 : defaults.https) {
            options.https = { ...defaults.https, ...options.https };
        }
        if ('rejectUnauthorized' in options) {
            deprecation_warning_1.default('"options.rejectUnauthorized" is now deprecated, please use "options.https.rejectUnauthorized"');
        }
        if ('checkServerIdentity' in options) {
            deprecation_warning_1.default('"options.checkServerIdentity" was never documented, please use "options.https.checkServerIdentity"');
        }
        if ('ca' in options) {
            deprecation_warning_1.default('"options.ca" was never documented, please use "options.https.certificateAuthority"');
        }
        if ('key' in options) {
            deprecation_warning_1.default('"options.key" was never documented, please use "options.https.key"');
        }
        if ('cert' in options) {
            deprecation_warning_1.default('"options.cert" was never documented, please use "options.https.certificate"');
        }
        if ('passphrase' in options) {
            deprecation_warning_1.default('"options.passphrase" was never documented, please use "options.https.passphrase"');
        }
        if ('pfx' in options) {
            deprecation_warning_1.default('"options.pfx" was never documented, please use "options.https.pfx"');
        }
        // Other options
        if ('followRedirects' in options) {
            throw new TypeError('The `followRedirects` option does not exist. Use `followRedirect` instead.');
        }
        if (options.agent) {
            for (const key in options.agent) {
                if (key !== 'http' && key !== 'https' && key !== 'http2') {
                    throw new TypeError(`Expected the \`options.agent\` properties to be \`http\`, \`https\` or \`http2\`, got \`${key}\``);
                }
            }
        }
        options.maxRedirects = (_e = options.maxRedirects) !== null && _e !== void 0 ? _e : 0;
        // Set non-enumerable properties
        exports.setNonEnumerableProperties([defaults, rawOptions], options);
        return normalize_arguments_1.default(options, defaults);
    }
    _lockWrite() {
        const onLockedWrite = () => {
            throw new TypeError('The payload has been already provided');
        };
        this.write = onLockedWrite;
        this.end = onLockedWrite;
    }
    _unlockWrite() {
        this.write = super.write;
        this.end = super.end;
    }
    async _finalizeBody() {
        const { options } = this;
        const { headers } = options;
        const isForm = !is_1.default.undefined(options.form);
        const isJSON = !is_1.default.undefined(options.json);
        const isBody = !is_1.default.undefined(options.body);
        const hasPayload = isForm || isJSON || isBody;
        const cannotHaveBody = exports.withoutBody.has(options.method) && !(options.method === 'GET' && options.allowGetBody);
        this._cannotHaveBody = cannotHaveBody;
        if (hasPayload) {
            if (cannotHaveBody) {
                throw new TypeError(`The \`${options.method}\` method cannot be used with a body`);
            }
            if ([isBody, isForm, isJSON].filter(isTrue => isTrue).length > 1) {
                throw new TypeError('The `body`, `json` and `form` options are mutually exclusive');
            }
            if (isBody &&
                !(options.body instanceof stream_1.Readable) &&
                !is_1.default.string(options.body) &&
                !is_1.default.buffer(options.body) &&
                !is_form_data_1.default(options.body)) {
                throw new TypeError('The `body` option must be a stream.Readable, string or Buffer');
            }
            if (isForm && !is_1.default.object(options.form)) {
                throw new TypeError('The `form` option must be an Object');
            }
            {
                // Serialize body
                const noContentType = !is_1.default.string(headers['content-type']);
                if (isBody) {
                    // Special case for https://github.com/form-data/form-data
                    if (is_form_data_1.default(options.body) && noContentType) {
                        headers['content-type'] = `multipart/form-data; boundary=${options.body.getBoundary()}`;
                    }
                    this[kBody] = options.body;
                }
                else if (isForm) {
                    if (noContentType) {
                        headers['content-type'] = 'application/x-www-form-urlencoded';
                    }
                    this[kBody] = (new url_1.URLSearchParams(options.form)).toString();
                }
                else {
                    if (noContentType) {
                        headers['content-type'] = 'application/json';
                    }
                    this[kBody] = options.stringifyJson(options.json);
                }
                const uploadBodySize = await get_body_size_1.default(this[kBody], options.headers);
                // See https://tools.ietf.org/html/rfc7230#section-3.3.2
                // A user agent SHOULD send a Content-Length in a request message when
                // no Transfer-Encoding is sent and the request method defines a meaning
                // for an enclosed payload body.  For example, a Content-Length header
                // field is normally sent in a POST request even when the value is 0
                // (indicating an empty payload body).  A user agent SHOULD NOT send a
                // Content-Length header field when the request message does not contain
                // a payload body and the method semantics do not anticipate such a
                // body.
                if (is_1.default.undefined(headers['content-length']) && is_1.default.undefined(headers['transfer-encoding'])) {
                    if (!cannotHaveBody && !is_1.default.undefined(uploadBodySize)) {
                        headers['content-length'] = String(uploadBodySize);
                    }
                }
            }
        }
        else if (cannotHaveBody) {
            this._lockWrite();
        }
        else {
            this._unlockWrite();
        }
        this[kBodySize] = Number(headers['content-length']) || undefined;
    }
    async _onResponseBase(response) {
        const { options } = this;
        const { url } = options;
        this[kOriginalResponse] = response;
        if (options.decompress) {
            response = decompressResponse(response);
        }
        const statusCode = response.statusCode;
        const typedResponse = response;
        typedResponse.statusMessage = typedResponse.statusMessage ? typedResponse.statusMessage : http.STATUS_CODES[statusCode];
        typedResponse.url = options.url.toString();
        typedResponse.requestUrl = this.requestUrl;
        typedResponse.redirectUrls = this.redirects;
        typedResponse.request = this;
        typedResponse.isFromCache = response.fromCache || false;
        typedResponse.ip = this.ip;
        typedResponse.retryCount = this.retryCount;
        this[kIsFromCache] = typedResponse.isFromCache;
        this[kResponseSize] = Number(response.headers['content-length']) || undefined;
        this[kResponse] = response;
        response.once('end', () => {
            this[kResponseSize] = this[kDownloadedSize];
            this.emit('downloadProgress', this.downloadProgress);
        });
        response.once('error', (error) => {
            // Force clean-up, because some packages don't do this.
            // TODO: Fix decompress-response
            response.destroy();
            this._beforeError(new ReadError(error, this));
        });
        response.once('aborted', () => {
            this._beforeError(new ReadError({
                name: 'Error',
                message: 'The server aborted pending request',
                code: 'ECONNRESET'
            }, this));
        });
        this.emit('downloadProgress', this.downloadProgress);
        const rawCookies = response.headers['set-cookie'];
        if (is_1.default.object(options.cookieJar) && rawCookies) {
            let promises = rawCookies.map(async (rawCookie) => options.cookieJar.setCookie(rawCookie, url.toString()));
            if (options.ignoreInvalidCookies) {
                promises = promises.map(async (p) => p.catch(() => { }));
            }
            try {
                await Promise.all(promises);
            }
            catch (error) {
                this._beforeError(error);
                return;
            }
        }
        if (options.followRedirect && response.headers.location && redirectCodes.has(statusCode)) {
            // We're being redirected, we don't care about the response.
            // It'd be best to abort the request, but we can't because
            // we would have to sacrifice the TCP connection. We don't want that.
            response.resume();
            if (this[kRequest]) {
                this[kCancelTimeouts]();
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete this[kRequest];
                this[kUnproxyEvents]();
            }
            const shouldBeGet = statusCode === 303 && options.method !== 'GET' && options.method !== 'HEAD';
            if (shouldBeGet || !options.methodRewriting) {
                // Server responded with "see other", indicating that the resource exists at another location,
                // and the client should request it from that location via GET or HEAD.
                options.method = 'GET';
                if ('body' in options) {
                    delete options.body;
                }
                if ('json' in options) {
                    delete options.json;
                }
                if ('form' in options) {
                    delete options.form;
                }
                this[kBody] = undefined;
                delete options.headers['content-length'];
            }
            if (this.redirects.length >= options.maxRedirects) {
                this._beforeError(new MaxRedirectsError(this));
                return;
            }
            try {
                // Do not remove. See https://github.com/sindresorhus/got/pull/214
                const redirectBuffer = Buffer.from(response.headers.location, 'binary').toString();
                // Handles invalid URLs. See https://github.com/sindresorhus/got/issues/604
                const redirectUrl = new url_1.URL(redirectBuffer, url);
                const redirectString = redirectUrl.toString();
                decodeURI(redirectString);
                // Redirecting to a different site, clear sensitive data.
                if (redirectUrl.hostname !== url.hostname || redirectUrl.port !== url.port) {
                    if ('host' in options.headers) {
                        delete options.headers.host;
                    }
                    if ('cookie' in options.headers) {
                        delete options.headers.cookie;
                    }
                    if ('authorization' in options.headers) {
                        delete options.headers.authorization;
                    }
                    if (options.username || options.password) {
                        options.username = '';
                        options.password = '';
                    }
                }
                else {
                    redirectUrl.username = options.username;
                    redirectUrl.password = options.password;
                }
                this.redirects.push(redirectString);
                options.url = redirectUrl;
                for (const hook of options.hooks.beforeRedirect) {
                    // eslint-disable-next-line no-await-in-loop
                    await hook(options, typedResponse);
                }
                this.emit('redirect', typedResponse, options);
                await this._makeRequest();
            }
            catch (error) {
                this._beforeError(error);
                return;
            }
            return;
        }
        if (options.isStream && options.throwHttpErrors && !is_response_ok_1.isResponseOk(typedResponse)) {
            this._beforeError(new HTTPError(typedResponse));
            return;
        }
        response.on('readable', () => {
            if (this[kTriggerRead]) {
                this._read();
            }
        });
        this.on('resume', () => {
            response.resume();
        });
        this.on('pause', () => {
            response.pause();
        });
        response.once('end', () => {
            this.push(null);
        });
        this.emit('response', response);
        for (const destination of this[kServerResponsesPiped]) {
            if (destination.headersSent) {
                continue;
            }
            // eslint-disable-next-line guard-for-in
            for (const key in response.headers) {
                const isAllowed = options.decompress ? key !== 'content-encoding' : true;
                const value = response.headers[key];
                if (isAllowed) {
                    destination.setHeader(key, value);
                }
            }
            destination.statusCode = statusCode;
        }
    }
    async _onResponse(response) {
        try {
            await this._onResponseBase(response);
        }
        catch (error) {
            /* istanbul ignore next: better safe than sorry */
            this._beforeError(error);
        }
    }
    _onRequest(request) {
        const { options } = this;
        const { timeout, url } = options;
        http_timer_1.default(request);
        this[kCancelTimeouts] = timed_out_1.default(request, timeout, url);
        const responseEventName = options.cache ? 'cacheableResponse' : 'response';
        request.once(responseEventName, (response) => {
            void this._onResponse(response);
        });
        request.once('error', (error) => {
            var _a;
            // Force clean-up, because some packages (e.g. nock) don't do this.
            request.destroy();
            // Node.js <= 12.18.2 mistakenly emits the response `end` first.
            (_a = request.res) === null || _a === void 0 ? void 0 : _a.removeAllListeners('end');
            error = error instanceof timed_out_1.TimeoutError ? new TimeoutError(error, this.timings, this) : new RequestError(error.message, error, this);
            this._beforeError(error);
        });
        this[kUnproxyEvents] = proxy_events_1.default(request, this, proxiedRequestEvents);
        this[kRequest] = request;
        this.emit('uploadProgress', this.uploadProgress);
        // Send body
        const body = this[kBody];
        const currentRequest = this.redirects.length === 0 ? this : request;
        if (is_1.default.nodeStream(body)) {
            body.pipe(currentRequest);
            body.once('error', (error) => {
                this._beforeError(new UploadError(error, this));
            });
        }
        else {
            this._unlockWrite();
            if (!is_1.default.undefined(body)) {
                this._writeRequest(body, undefined, () => { });
                currentRequest.end();
                this._lockWrite();
            }
            else if (this._cannotHaveBody || this._noPipe) {
                currentRequest.end();
                this._lockWrite();
            }
        }
        this.emit('request', request);
    }
    async _createCacheableRequest(url, options) {
        return new Promise((resolve, reject) => {
            // TODO: Remove `utils/url-to-options.ts` when `cacheable-request` is fixed
            Object.assign(options, url_to_options_1.default(url));
            // `http-cache-semantics` checks this
            // TODO: Fix this ignore.
            // @ts-expect-error
            delete options.url;
            let request;
            // This is ugly
            const cacheRequest = cacheableStore.get(options.cache)(options, async (response) => {
                // TODO: Fix `cacheable-response`
                response._readableState.autoDestroy = false;
                if (request) {
                    (await request).emit('cacheableResponse', response);
                }
                resolve(response);
            });
            // Restore options
            options.url = url;
            cacheRequest.once('error', reject);
            cacheRequest.once('request', async (requestOrPromise) => {
                request = requestOrPromise;
                resolve(request);
            });
        });
    }
    async _makeRequest() {
        var _a, _b, _c, _d, _e;
        const { options } = this;
        const { headers } = options;
        for (const key in headers) {
            if (is_1.default.undefined(headers[key])) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete headers[key];
            }
            else if (is_1.default.null_(headers[key])) {
                throw new TypeError(`Use \`undefined\` instead of \`null\` to delete the \`${key}\` header`);
            }
        }
        if (options.decompress && is_1.default.undefined(headers['accept-encoding'])) {
            headers['accept-encoding'] = supportsBrotli ? 'gzip, deflate, br' : 'gzip, deflate';
        }
        // Set cookies
        if (options.cookieJar) {
            const cookieString = await options.cookieJar.getCookieString(options.url.toString());
            if (is_1.default.nonEmptyString(cookieString)) {
                options.headers.cookie = cookieString;
            }
        }
        for (const hook of options.hooks.beforeRequest) {
            // eslint-disable-next-line no-await-in-loop
            const result = await hook(options);
            if (!is_1.default.undefined(result)) {
                // @ts-expect-error Skip the type mismatch to support abstract responses
                options.request = () => result;
                break;
            }
        }
        if (options.body && this[kBody] !== options.body) {
            this[kBody] = options.body;
        }
        const { agent, request, timeout, url } = options;
        if (options.dnsCache && !('lookup' in options)) {
            options.lookup = options.dnsCache.lookup;
        }
        // UNIX sockets
        if (url.hostname === 'unix') {
            const matches = /(?<socketPath>.+?):(?<path>.+)/.exec(`${url.pathname}${url.search}`);
            if (matches === null || matches === void 0 ? void 0 : matches.groups) {
                const { socketPath, path } = matches.groups;
                Object.assign(options, {
                    socketPath,
                    path,
                    host: ''
                });
            }
        }
        const isHttps = url.protocol === 'https:';
        // Fallback function
        let fallbackFn;
        if (options.http2) {
            fallbackFn = http2wrapper.auto;
        }
        else {
            fallbackFn = isHttps ? https.request : http.request;
        }
        const realFn = (_a = options.request) !== null && _a !== void 0 ? _a : fallbackFn;
        // Cache support
        const fn = options.cache ? this._createCacheableRequest : realFn;
        // Pass an agent directly when HTTP2 is disabled
        if (agent && !options.http2) {
            options.agent = agent[isHttps ? 'https' : 'http'];
        }
        // Prepare plain HTTP request options
        options[kRequest] = realFn;
        delete options.request;
        // TODO: Fix this ignore.
        // @ts-expect-error
        delete options.timeout;
        const requestOptions = options;
        requestOptions.shared = (_b = options.cacheOptions) === null || _b === void 0 ? void 0 : _b.shared;
        requestOptions.cacheHeuristic = (_c = options.cacheOptions) === null || _c === void 0 ? void 0 : _c.cacheHeuristic;
        requestOptions.immutableMinTimeToLive = (_d = options.cacheOptions) === null || _d === void 0 ? void 0 : _d.immutableMinTimeToLive;
        requestOptions.ignoreCargoCult = (_e = options.cacheOptions) === null || _e === void 0 ? void 0 : _e.ignoreCargoCult;
        // If `dnsLookupIpVersion` is not present do not override `family`
        if (options.dnsLookupIpVersion !== undefined) {
            try {
                requestOptions.family = dns_ip_version_1.dnsLookupIpVersionToFamily(options.dnsLookupIpVersion);
            }
            catch (_f) {
                throw new Error('Invalid `dnsLookupIpVersion` option value');
            }
        }
        // HTTPS options remapping
        if (options.https) {
            if ('rejectUnauthorized' in options.https) {
                requestOptions.rejectUnauthorized = options.https.rejectUnauthorized;
            }
            if (options.https.checkServerIdentity) {
                requestOptions.checkServerIdentity = options.https.checkServerIdentity;
            }
            if (options.https.certificateAuthority) {
                requestOptions.ca = options.https.certificateAuthority;
            }
            if (options.https.certificate) {
                requestOptions.cert = options.https.certificate;
            }
            if (options.https.key) {
                requestOptions.key = options.https.key;
            }
            if (options.https.passphrase) {
                requestOptions.passphrase = options.https.passphrase;
            }
            if (options.https.pfx) {
                requestOptions.pfx = options.https.pfx;
            }
        }
        try {
            let requestOrResponse = await fn(url, requestOptions);
            if (is_1.default.undefined(requestOrResponse)) {
                requestOrResponse = fallbackFn(url, requestOptions);
            }
            // Restore options
            options.request = request;
            options.timeout = timeout;
            options.agent = agent;
            // HTTPS options restore
            if (options.https) {
                if ('rejectUnauthorized' in options.https) {
                    delete requestOptions.rejectUnauthorized;
                }
                if (options.https.checkServerIdentity) {
                    // @ts-expect-error - This one will be removed when we remove the alias.
                    delete requestOptions.checkServerIdentity;
                }
                if (options.https.certificateAuthority) {
                    delete requestOptions.ca;
                }
                if (options.https.certificate) {
                    delete requestOptions.cert;
                }
                if (options.https.key) {
                    delete requestOptions.key;
                }
                if (options.https.passphrase) {
                    delete requestOptions.passphrase;
                }
                if (options.https.pfx) {
                    delete requestOptions.pfx;
                }
            }
            if (isClientRequest(requestOrResponse)) {
                this._onRequest(requestOrResponse);
                // Emit the response after the stream has been ended
            }
            else if (this.writable) {
                this.once('finish', () => {
                    void this._onResponse(requestOrResponse);
                });
                this._unlockWrite();
                this.end();
                this._lockWrite();
            }
            else {
                void this._onResponse(requestOrResponse);
            }
        }
        catch (error) {
            if (error instanceof CacheableRequest.CacheError) {
                throw new CacheError(error, this);
            }
            throw new RequestError(error.message, error, this);
        }
    }
    async _error(error) {
        try {
            for (const hook of this.options.hooks.beforeError) {
                // eslint-disable-next-line no-await-in-loop
                error = await hook(error);
            }
        }
        catch (error_) {
            error = new RequestError(error_.message, error_, this);
        }
        this.destroy(error);
    }
    _beforeError(error) {
        if (this[kStopReading]) {
            return;
        }
        const { options } = this;
        const retryCount = this.retryCount + 1;
        this[kStopReading] = true;
        if (!(error instanceof RequestError)) {
            error = new RequestError(error.message, error, this);
        }
        const typedError = error;
        const { response } = typedError;
        void (async () => {
            if (response && !response.body) {
                response.setEncoding(this._readableState.encoding);
                try {
                    response.rawBody = await get_buffer_1.default(response);
                    response.body = response.rawBody.toString();
                }
                catch (_a) { }
            }
            if (this.listenerCount('retry') !== 0) {
                let backoff;
                try {
                    let retryAfter;
                    if (response && 'retry-after' in response.headers) {
                        retryAfter = Number(response.headers['retry-after']);
                        if (Number.isNaN(retryAfter)) {
                            retryAfter = Date.parse(response.headers['retry-after']) - Date.now();
                            if (retryAfter <= 0) {
                                retryAfter = 1;
                            }
                        }
                        else {
                            retryAfter *= 1000;
                        }
                    }
                    backoff = await options.retry.calculateDelay({
                        attemptCount: retryCount,
                        retryOptions: options.retry,
                        error: typedError,
                        retryAfter,
                        computedValue: calculate_retry_delay_1.default({
                            attemptCount: retryCount,
                            retryOptions: options.retry,
                            error: typedError,
                            retryAfter,
                            computedValue: 0
                        })
                    });
                }
                catch (error_) {
                    void this._error(new RequestError(error_.message, error_, this));
                    return;
                }
                if (backoff) {
                    const retry = async () => {
                        try {
                            for (const hook of this.options.hooks.beforeRetry) {
                                // eslint-disable-next-line no-await-in-loop
                                await hook(this.options, typedError, retryCount);
                            }
                        }
                        catch (error_) {
                            void this._error(new RequestError(error_.message, error, this));
                            return;
                        }
                        // Something forced us to abort the retry
                        if (this.destroyed) {
                            return;
                        }
                        this.destroy();
                        this.emit('retry', retryCount, error);
                    };
                    this[kRetryTimeout] = setTimeout(retry, backoff);
                    return;
                }
            }
            void this._error(typedError);
        })();
    }
    _read() {
        this[kTriggerRead] = true;
        const response = this[kResponse];
        if (response && !this[kStopReading]) {
            // We cannot put this in the `if` above
            // because `.read()` also triggers the `end` event
            if (response.readableLength) {
                this[kTriggerRead] = false;
            }
            let data;
            while ((data = response.read()) !== null) {
                this[kDownloadedSize] += data.length;
                this[kStartedReading] = true;
                const progress = this.downloadProgress;
                if (progress.percent < 1) {
                    this.emit('downloadProgress', progress);
                }
                this.push(data);
            }
        }
    }
    // Node.js 12 has incorrect types, so the encoding must be a string
    _write(chunk, encoding, callback) {
        const write = () => {
            this._writeRequest(chunk, encoding, callback);
        };
        if (this.requestInitialized) {
            write();
        }
        else {
            this[kJobs].push(write);
        }
    }
    _writeRequest(chunk, encoding, callback) {
        if (this[kRequest].destroyed) {
            // Probably the `ClientRequest` instance will throw
            return;
        }
        this._progressCallbacks.push(() => {
            this[kUploadedSize] += Buffer.byteLength(chunk, encoding);
            const progress = this.uploadProgress;
            if (progress.percent < 1) {
                this.emit('uploadProgress', progress);
            }
        });
        // TODO: What happens if it's from cache? Then this[kRequest] won't be defined.
        this[kRequest].write(chunk, encoding, (error) => {
            if (!error && this._progressCallbacks.length > 0) {
                this._progressCallbacks.shift()();
            }
            callback(error);
        });
    }
    _final(callback) {
        const endRequest = () => {
            // FIX: Node.js 10 calls the write callback AFTER the end callback!
            while (this._progressCallbacks.length !== 0) {
                this._progressCallbacks.shift()();
            }
            // We need to check if `this[kRequest]` is present,
            // because it isn't when we use cache.
            if (!(kRequest in this)) {
                callback();
                return;
            }
            if (this[kRequest].destroyed) {
                callback();
                return;
            }
            this[kRequest].end((error) => {
                if (!error) {
                    this[kBodySize] = this[kUploadedSize];
                    this.emit('uploadProgress', this.uploadProgress);
                    this[kRequest].emit('upload-complete');
                }
                callback(error);
            });
        };
        if (this.requestInitialized) {
            endRequest();
        }
        else {
            this[kJobs].push(endRequest);
        }
    }
    _destroy(error, callback) {
        var _a;
        this[kStopReading] = true;
        // Prevent further retries
        clearTimeout(this[kRetryTimeout]);
        if (kRequest in this) {
            this[kCancelTimeouts]();
            // TODO: Remove the next `if` when these get fixed:
            // - https://github.com/nodejs/node/issues/32851
            if (!((_a = this[kResponse]) === null || _a === void 0 ? void 0 : _a.complete)) {
                this[kRequest].destroy();
            }
        }
        if (error !== null && !is_1.default.undefined(error) && !(error instanceof RequestError)) {
            error = new RequestError(error.message, error, this);
        }
        callback(error);
    }
    get _isAboutToError() {
        return this[kStopReading];
    }
    /**
    The remote IP address.
    */
    get ip() {
        var _a;
        return (_a = this.socket) === null || _a === void 0 ? void 0 : _a.remoteAddress;
    }
    /**
    Indicates whether the request has been aborted or not.
    */
    get aborted() {
        var _a, _b, _c;
        return ((_b = (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.destroyed) !== null && _b !== void 0 ? _b : this.destroyed) && !((_c = this[kOriginalResponse]) === null || _c === void 0 ? void 0 : _c.complete);
    }
    get socket() {
        var _a, _b;
        return (_b = (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.socket) !== null && _b !== void 0 ? _b : undefined;
    }
    /**
    Progress event for downloading (receiving a response).
    */
    get downloadProgress() {
        let percent;
        if (this[kResponseSize]) {
            percent = this[kDownloadedSize] / this[kResponseSize];
        }
        else if (this[kResponseSize] === this[kDownloadedSize]) {
            percent = 1;
        }
        else {
            percent = 0;
        }
        return {
            percent,
            transferred: this[kDownloadedSize],
            total: this[kResponseSize]
        };
    }
    /**
    Progress event for uploading (sending a request).
    */
    get uploadProgress() {
        let percent;
        if (this[kBodySize]) {
            percent = this[kUploadedSize] / this[kBodySize];
        }
        else if (this[kBodySize] === this[kUploadedSize]) {
            percent = 1;
        }
        else {
            percent = 0;
        }
        return {
            percent,
            transferred: this[kUploadedSize],
            total: this[kBodySize]
        };
    }
    /**
    The object contains the following properties:

    - `start` - Time when the request started.
    - `socket` - Time when a socket was assigned to the request.
    - `lookup` - Time when the DNS lookup finished.
    - `connect` - Time when the socket successfully connected.
    - `secureConnect` - Time when the socket securely connected.
    - `upload` - Time when the request finished uploading.
    - `response` - Time when the request fired `response` event.
    - `end` - Time when the response fired `end` event.
    - `error` - Time when the request fired `error` event.
    - `abort` - Time when the request fired `abort` event.
    - `phases`
        - `wait` - `timings.socket - timings.start`
        - `dns` - `timings.lookup - timings.socket`
        - `tcp` - `timings.connect - timings.lookup`
        - `tls` - `timings.secureConnect - timings.connect`
        - `request` - `timings.upload - (timings.secureConnect || timings.connect)`
        - `firstByte` - `timings.response - timings.upload`
        - `download` - `timings.end - timings.response`
        - `total` - `(timings.end || timings.error || timings.abort) - timings.start`

    If something has not been measured yet, it will be `undefined`.

    __Note__: The time is a `number` representing the milliseconds elapsed since the UNIX epoch.
    */
    get timings() {
        var _a;
        return (_a = this[kRequest]) === null || _a === void 0 ? void 0 : _a.timings;
    }
    /**
    Whether the response was retrieved from the cache.
    */
    get isFromCache() {
        return this[kIsFromCache];
    }
    pipe(destination, options) {
        if (this[kStartedReading]) {
            throw new Error('Failed to pipe. The response has been emitted already.');
        }
        if (destination instanceof http_1.ServerResponse) {
            this[kServerResponsesPiped].add(destination);
        }
        return super.pipe(destination, options);
    }
    unpipe(destination) {
        if (destination instanceof http_1.ServerResponse) {
            this[kServerResponsesPiped].delete(destination);
        }
        super.unpipe(destination);
        return this;
    }
}
exports.default = Request;


/***/ }),

/***/ 97:
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const defer_to_connect_1 = __webpack_require__(214);
const nodejsMajorVersion = Number(process.versions.node.split('.')[0]);
const timer = (request) => {
    const timings = {
        start: Date.now(),
        socket: undefined,
        lookup: undefined,
        connect: undefined,
        secureConnect: undefined,
        upload: undefined,
        response: undefined,
        end: undefined,
        error: undefined,
        abort: undefined,
        phases: {
            wait: undefined,
            dns: undefined,
            tcp: undefined,
            tls: undefined,
            request: undefined,
            firstByte: undefined,
            download: undefined,
            total: undefined
        }
    };
    request.timings = timings;
    const handleError = (origin) => {
        const emit = origin.emit.bind(origin);
        origin.emit = (event, ...args) => {
            // Catches the `error` event
            if (event === 'error') {
                timings.error = Date.now();
                timings.phases.total = timings.error - timings.start;
                origin.emit = emit;
            }
            // Saves the original behavior
            return emit(event, ...args);
        };
    };
    handleError(request);
    request.prependOnceListener('abort', () => {
        timings.abort = Date.now();
        // Let the `end` response event be responsible for setting the total phase,
        // unless the Node.js major version is >= 13.
        if (!timings.response || nodejsMajorVersion >= 13) {
            timings.phases.total = Date.now() - timings.start;
        }
    });
    const onSocket = (socket) => {
        timings.socket = Date.now();
        timings.phases.wait = timings.socket - timings.start;
        const lookupListener = () => {
            timings.lookup = Date.now();
            timings.phases.dns = timings.lookup - timings.socket;
        };
        socket.prependOnceListener('lookup', lookupListener);
        defer_to_connect_1.default(socket, {
            connect: () => {
                timings.connect = Date.now();
                if (timings.lookup === undefined) {
                    socket.removeListener('lookup', lookupListener);
                    timings.lookup = timings.connect;
                    timings.phases.dns = timings.lookup - timings.socket;
                }
                timings.phases.tcp = timings.connect - timings.lookup;
                // This callback is called before flushing any data,
                // so we don't need to set `timings.phases.request` here.
            },
            secureConnect: () => {
                timings.secureConnect = Date.now();
                timings.phases.tls = timings.secureConnect - timings.connect;
            }
        });
    };
    if (request.socket) {
        onSocket(request.socket);
    }
    else {
        request.prependOnceListener('socket', onSocket);
    }
    const onUpload = () => {
        var _a;
        timings.upload = Date.now();
        timings.phases.request = timings.upload - (_a = timings.secureConnect, (_a !== null && _a !== void 0 ? _a : timings.connect));
    };
    const writableFinished = () => {
        if (typeof request.writableFinished === 'boolean') {
            return request.writableFinished;
        }
        // Node.js doesn't have `request.writableFinished` property
        return request.finished && request.outputSize === 0 && (!request.socket || request.socket.writableLength === 0);
    };
    if (writableFinished()) {
        onUpload();
    }
    else {
        request.prependOnceListener('finish', onUpload);
    }
    request.prependOnceListener('response', (response) => {
        timings.response = Date.now();
        timings.phases.firstByte = timings.response - timings.upload;
        response.timings = timings;
        handleError(response);
        response.prependOnceListener('end', () => {
            timings.end = Date.now();
            timings.phases.download = timings.end - timings.response;
            timings.phases.total = timings.end - timings.start;
        });
    });
    return timings;
};
exports.default = timer;
// For CommonJS default export support
module.exports = timer;
module.exports.default = timer;


/***/ }),

/***/ 109:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(__webpack_require__(186));
const github = __importStar(__webpack_require__(438));
const google_translate_api_1 = __importDefault(__webpack_require__(771));
let franc = __webpack_require__(554);
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if ((github.context.eventName !== 'issue_comment' || github.context.payload.action !== 'created') &&
                (github.context.eventName !== 'issues' || github.context.payload.action !== 'opened')) {
                core.info(`The status of the action must be created on issue_comment, no applicable - ${github.context.payload.action} on ${github.context.eventName}, return`);
                return;
            }
            let issueNumber = null;
            let originBody = null;
            let issueUser = null;
            if (github.context.eventName === 'issue_comment') {
                const issueCommentPayload = github.context
                    .payload;
                issueNumber = issueCommentPayload.issue.number;
                issueUser = issueCommentPayload.comment.user.login;
                originBody = issueCommentPayload.comment.body;
            }
            else {
                const issuePayload = github.context.payload;
                issueNumber = issuePayload.issue.number;
                issueUser = issuePayload.issue.user.login;
                originBody =
                    `
**Title:** ${issuePayload.issue.title}  

${issuePayload.issue.body}  
      `;
            }
            // detect comment body is english
            if (detectIsEnglish(originBody)) {
                core.info('Detect the issue comment body is english already, ignore return.');
                return;
            }
            // ignore when bot comment issue himself
            let botToken = core.getInput('BOT_GITHUB_TOKEN');
            let botLoginName = core.getInput('BOT_LOGIN_NAME');
            if (botToken === null || botToken === undefined || botToken === '') {
                // use the default github bot token
                const defaultBotTokenBase64 = 'Y2I4M2EyNjE0NThlMzIwMjA3MGJhODRlY2I5NTM0ZjBmYTEwM2ZlNg==';
                const defaultBotLoginName = 'Issues-translate-bot';
                botToken = Buffer.from(defaultBotTokenBase64, 'base64').toString();
                botLoginName = defaultBotLoginName;
            }
            let octokit = null;
            if (botLoginName === null || botLoginName === undefined || botLoginName === '') {
                octokit = github.getOctokit(botToken);
                const botInfo = yield octokit.request('GET /user');
                botLoginName = botInfo.data.login;
            }
            if (botLoginName === issueUser) {
                core.info(`The issue comment user is bot ${botLoginName} himself, ignore return.`);
                return;
            }
            // translate issue comment body to english
            const translateBody = yield translateCommentBody(originBody, issueUser);
            if (translateBody === null
                || translateBody === ''
                || translateBody === originBody) {
                core.warning("The translateBody is null or same, ignore return.");
                return;
            }
            // create comment by bot
            if (octokit === null) {
                octokit = github.getOctokit(botToken);
            }
            yield createComment(issueNumber, translateBody, octokit);
            core.setOutput('complete time', new Date().toTimeString());
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
function detectIsEnglish(body) {
    const detectResult = franc(body);
    if (detectResult === 'und'
        || detectResult === undefined
        || detectResult === null) {
        core.warning(`Can not detect the undetermined comment body: ${body}`);
        return false;
    }
    core.info(`Detect comment body language result is: ${detectResult}`);
    return detectResult === 'eng';
}
function translateCommentBody(body, issueUser) {
    return __awaiter(this, void 0, void 0, function* () {
        let result = '';
        yield google_translate_api_1.default(body, { to: 'en' })
            .then(res => {
            if (res.text !== body) {
                result =
                    ` 
> Bot detected the issue body's language is not English, translate it automatically. 👯.     
----  

${res.text}  
      `;
            }
        })
            .catch(err => {
            core.error(err);
            core.setFailed(err.message);
        });
        return result;
    });
}
function createComment(issueNumber, body, octokit) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const { owner, repo } = github.context.repo;
        const issue_url = (_a = github.context.payload.issue) === null || _a === void 0 ? void 0 : _a.html_url;
        yield octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body
        });
        core.info(`complete to push translate issue comment: ${body} in ${issue_url} `);
    });
}
run();


/***/ }),

/***/ 116:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const EventEmitter = __webpack_require__(614);
const urlLib = __webpack_require__(835);
const normalizeUrl = __webpack_require__(952);
const getStream = __webpack_require__(40);
const CachePolicy = __webpack_require__(2);
const Response = __webpack_require__(4);
const lowercaseKeys = __webpack_require__(662);
const cloneResponse = __webpack_require__(312);
const Keyv = __webpack_require__(531);

class CacheableRequest {
	constructor(request, cacheAdapter) {
		if (typeof request !== 'function') {
			throw new TypeError('Parameter `request` must be a function');
		}

		this.cache = new Keyv({
			uri: typeof cacheAdapter === 'string' && cacheAdapter,
			store: typeof cacheAdapter !== 'string' && cacheAdapter,
			namespace: 'cacheable-request'
		});

		return this.createCacheableRequest(request);
	}

	createCacheableRequest(request) {
		return (opts, cb) => {
			let url;
			if (typeof opts === 'string') {
				url = normalizeUrlObject(urlLib.parse(opts));
				opts = {};
			} else if (opts instanceof urlLib.URL) {
				url = normalizeUrlObject(urlLib.parse(opts.toString()));
				opts = {};
			} else {
				const [pathname, ...searchParts] = (opts.path || '').split('?');
				const search = searchParts.length > 0 ?
					`?${searchParts.join('?')}` :
					'';
				url = normalizeUrlObject({ ...opts, pathname, search });
			}

			opts = {
				headers: {},
				method: 'GET',
				cache: true,
				strictTtl: false,
				automaticFailover: false,
				...opts,
				...urlObjectToRequestOptions(url)
			};
			opts.headers = lowercaseKeys(opts.headers);

			const ee = new EventEmitter();
			const normalizedUrlString = normalizeUrl(
				urlLib.format(url),
				{
					stripWWW: false,
					removeTrailingSlash: false,
					stripAuthentication: false
				}
			);
			const key = `${opts.method}:${normalizedUrlString}`;
			let revalidate = false;
			let madeRequest = false;

			const makeRequest = opts => {
				madeRequest = true;
				let requestErrored = false;
				let requestErrorCallback;

				const requestErrorPromise = new Promise(resolve => {
					requestErrorCallback = () => {
						if (!requestErrored) {
							requestErrored = true;
							resolve();
						}
					};
				});

				const handler = response => {
					if (revalidate && !opts.forceRefresh) {
						response.status = response.statusCode;
						const revalidatedPolicy = CachePolicy.fromObject(revalidate.cachePolicy).revalidatedPolicy(opts, response);
						if (!revalidatedPolicy.modified) {
							const headers = revalidatedPolicy.policy.responseHeaders();
							response = new Response(revalidate.statusCode, headers, revalidate.body, revalidate.url);
							response.cachePolicy = revalidatedPolicy.policy;
							response.fromCache = true;
						}
					}

					if (!response.fromCache) {
						response.cachePolicy = new CachePolicy(opts, response, opts);
						response.fromCache = false;
					}

					let clonedResponse;
					if (opts.cache && response.cachePolicy.storable()) {
						clonedResponse = cloneResponse(response);

						(async () => {
							try {
								const bodyPromise = getStream.buffer(response);

								await Promise.race([
									requestErrorPromise,
									new Promise(resolve => response.once('end', resolve))
								]);

								if (requestErrored) {
									return;
								}

								const body = await bodyPromise;

								const value = {
									cachePolicy: response.cachePolicy.toObject(),
									url: response.url,
									statusCode: response.fromCache ? revalidate.statusCode : response.statusCode,
									body
								};

								let ttl = opts.strictTtl ? response.cachePolicy.timeToLive() : undefined;
								if (opts.maxTtl) {
									ttl = ttl ? Math.min(ttl, opts.maxTtl) : opts.maxTtl;
								}

								await this.cache.set(key, value, ttl);
							} catch (error) {
								ee.emit('error', new CacheableRequest.CacheError(error));
							}
						})();
					} else if (opts.cache && revalidate) {
						(async () => {
							try {
								await this.cache.delete(key);
							} catch (error) {
								ee.emit('error', new CacheableRequest.CacheError(error));
							}
						})();
					}

					ee.emit('response', clonedResponse || response);
					if (typeof cb === 'function') {
						cb(clonedResponse || response);
					}
				};

				try {
					const req = request(opts, handler);
					req.once('error', requestErrorCallback);
					req.once('abort', requestErrorCallback);
					ee.emit('request', req);
				} catch (error) {
					ee.emit('error', new CacheableRequest.RequestError(error));
				}
			};

			(async () => {
				const get = async opts => {
					await Promise.resolve();

					const cacheEntry = opts.cache ? await this.cache.get(key) : undefined;
					if (typeof cacheEntry === 'undefined') {
						return makeRequest(opts);
					}

					const policy = CachePolicy.fromObject(cacheEntry.cachePolicy);
					if (policy.satisfiesWithoutRevalidation(opts) && !opts.forceRefresh) {
						const headers = policy.responseHeaders();
						const response = new Response(cacheEntry.statusCode, headers, cacheEntry.body, cacheEntry.url);
						response.cachePolicy = policy;
						response.fromCache = true;

						ee.emit('response', response);
						if (typeof cb === 'function') {
							cb(response);
						}
					} else {
						revalidate = cacheEntry;
						opts.headers = policy.revalidationHeaders(opts);
						makeRequest(opts);
					}
				};

				const errorHandler = error => ee.emit('error', new CacheableRequest.CacheError(error));
				this.cache.once('error', errorHandler);
				ee.on('response', () => this.cache.removeListener('error', errorHandler));

				try {
					await get(opts);
				} catch (error) {
					if (opts.automaticFailover && !madeRequest) {
						makeRequest(opts);
					}

					ee.emit('error', new CacheableRequest.CacheError(error));
				}
			})();

			return ee;
		};
	}
}

function urlObjectToRequestOptions(url) {
	const options = { ...url };
	options.path = `${url.pathname || '/'}${url.search || ''}`;
	delete options.pathname;
	delete options.search;
	return options;
}

function normalizeUrlObject(url) {
	// If url was parsed by url.parse or new URL:
	// - hostname will be set
	// - host will be hostname[:port]
	// - port will be set if it was explicit in the parsed string
	// Otherwise, url was from request options:
	// - hostname or host may be set
	// - host shall not have port encoded
	return {
		protocol: url.protocol,
		auth: url.auth,
		hostname: url.hostname || url.host || 'localhost',
		port: url.port,
		pathname: url.pathname,
		search: url.search
	};
}

CacheableRequest.RequestError = class extends Error {
	constructor(error) {
		super(error.message);
		this.name = 'RequestError';
		Object.assign(this, error);
	}
};

CacheableRequest.CacheError = class extends Error {
	constructor(error) {
		super(error.message);
		this.name = 'CacheError';
		Object.assign(this, error);
	}
};

module.exports = CacheableRequest;


/***/ }),

/***/ 167:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const http = __webpack_require__(605);
const https = __webpack_require__(211);
const resolveALPN = __webpack_require__(624);
const QuickLRU = __webpack_require__(273);
const Http2ClientRequest = __webpack_require__(632);
const calculateServerName = __webpack_require__(982);
const urlToOptions = __webpack_require__(686);

const cache = new QuickLRU({maxSize: 100});
const queue = new Map();

const installSocket = (agent, socket, options) => {
	socket._httpMessage = {shouldKeepAlive: true};

	const onFree = () => {
		agent.emit('free', socket, options);
	};

	socket.on('free', onFree);

	const onClose = () => {
		agent.removeSocket(socket, options);
	};

	socket.on('close', onClose);

	const onRemove = () => {
		agent.removeSocket(socket, options);
		socket.off('close', onClose);
		socket.off('free', onFree);
		socket.off('agentRemove', onRemove);
	};

	socket.on('agentRemove', onRemove);

	agent.emit('free', socket, options);
};

const resolveProtocol = async options => {
	const name = `${options.host}:${options.port}:${options.ALPNProtocols.sort()}`;

	if (!cache.has(name)) {
		if (queue.has(name)) {
			const result = await queue.get(name);
			return result.alpnProtocol;
		}

		const {path, agent} = options;
		options.path = options.socketPath;

		const resultPromise = resolveALPN(options);
		queue.set(name, resultPromise);

		try {
			const {socket, alpnProtocol} = await resultPromise;
			cache.set(name, alpnProtocol);

			options.path = path;

			if (alpnProtocol === 'h2') {
				// https://github.com/nodejs/node/issues/33343
				socket.destroy();
			} else {
				const {globalAgent} = https;
				const defaultCreateConnection = https.Agent.prototype.createConnection;

				if (agent) {
					if (agent.createConnection === defaultCreateConnection) {
						installSocket(agent, socket, options);
					} else {
						socket.destroy();
					}
				} else if (globalAgent.createConnection === defaultCreateConnection) {
					installSocket(globalAgent, socket, options);
				} else {
					socket.destroy();
				}
			}

			queue.delete(name);

			return alpnProtocol;
		} catch (error) {
			queue.delete(name);

			throw error;
		}
	}

	return cache.get(name);
};

module.exports = async (input, options, callback) => {
	if (typeof input === 'string' || input instanceof URL) {
		input = urlToOptions(new URL(input));
	}

	if (typeof options === 'function') {
		callback = options;
		options = undefined;
	}

	options = {
		ALPNProtocols: ['h2', 'http/1.1'],
		...input,
		...options,
		resolveSocket: true
	};

	if (!Array.isArray(options.ALPNProtocols) || options.ALPNProtocols.length === 0) {
		throw new Error('The `ALPNProtocols` option must be an Array with at least one entry');
	}

	options.protocol = options.protocol || 'https:';
	const isHttps = options.protocol === 'https:';

	options.host = options.hostname || options.host || 'localhost';
	options.session = options.tlsSession;
	options.servername = options.servername || calculateServerName(options);
	options.port = options.port || (isHttps ? 443 : 80);
	options._defaultAgent = isHttps ? https.globalAgent : http.globalAgent;

	const agents = options.agent;

	if (agents) {
		if (agents.addRequest) {
			throw new Error('The `options.agent` object can contain only `http`, `https` or `http2` properties');
		}

		options.agent = agents[isHttps ? 'https' : 'http'];
	}

	if (isHttps) {
		const protocol = await resolveProtocol(options);

		if (protocol === 'h2') {
			if (agents) {
				options.agent = agents.http2;
			}

			return new Http2ClientRequest(options, callback);
		}
	}

	return http.request(options, callback);
};

module.exports.protocolCache = cache;


/***/ }),

/***/ 185:
/***/ (function(module, __unusedexports, __webpack_require__) {

/**
 * Last update: 2/11/2018
 * https://translate.google.com/translate/releases/twsfe_w_20160620_RC00/r/js/desktop_module_main.js
 *
 * Everything between 'BEGIN' and 'END' was copied from the script above.
 */

const got = __webpack_require__(61);

/* eslint-disable */
// BEGIN
function zr(a) {
    let b;
    if (null !== yr) b = yr;
    else {
        b = wr(String.fromCharCode(84));
        let c = wr(String.fromCharCode(75));
        b = [ b(), b() ];
        b[1] = c();
        b = (yr = window[b.join(c())] || "") || "";
    }
    let d = wr(String.fromCharCode(116));
    let c = wr(String.fromCharCode(107));
    d = [ d(), d() ];
    d[1] = c();
    c = "&" + d.join("") + "=";
    d = b.split(".");
    b = Number(d[0]) || 0;
    // eslint-disable-next-line no-var
    for (var e = [], f = 0, g = 0; g < a.length; g++) {
        let l = a.charCodeAt(g);
        128 > l ? e[f++] = l : (2048 > l ? e[f++] = l >> 6 | 192 : ((l & 64512) == 55296 && g + 1 < a.length && (a.charCodeAt(g + 1) & 64512) == 56320 ? (l = 65536 + ((l & 1023) << 10) + (a.charCodeAt(++g) & 1023), e[f++] = l >> 18 | 240, e[f++] = l >> 12 & 63 | 128) : e[f++] = l >> 12 | 224, e[f++] = l >> 6 & 63 | 128), e[f++] = l & 63 | 128);
    }
    a = b;
    for (let f = 0; f < e.length; f++) a += e[f], a = xr(a, "+-a^+6");
    a = xr(a, "+-3^+b+-f");
    a ^= Number(d[1]) || 0;
    0 > a && (a = (a & 2147483647) + 2147483648);
    a %= 1E6;
    return c + (a.toString() + "." + (a ^ b));
}

let yr = null;
let wr = function(a) {
    return function() {
        return a;
    };
};
let xr = function(a, b) {
    for (let c = 0; c < b.length - 2; c += 3) {
        let d = b.charAt(c + 2);
        d = d >= "a" ? d.charCodeAt(0) - 87 : Number(d);
        d = b.charAt(c + 1) == "+" ? a >>> d : a << d;
        a = b.charAt(c) == "+" ? a + d & 4294967295 : a ^ d;
    }
    return a;
};
// END
/* eslint-enable */

const config = new Map();

const window = {
    TKK: config.get("TKK") || "0"
};

// eslint-disable-next-line require-jsdoc
async function updateTKK() {
    try {
        let now = Math.floor(Date.now() / 3600000);

        if (Number(window.TKK.split(".")[0]) !== now) {
            let res = await got("https://translate.google.com");

            // code will extract something like tkk:'1232135.131231321312', we need only value
            const code = res.body.match(/tkk:'\d+.\d+'/g);

            if (code.length > 0) {
                // extracting value tkk:'1232135.131231321312', this will extract only token: 1232135.131231321312
                const xt = code[0].split(":")[1].replace(/'/g, "");

                window.TKK = xt;
                config.set("TKK", xt);
            }
        }
    }
    catch (e) {
        if (e.name === "HTTPError") {
            let error = new Error();
            error.name = e.name;
            error.statusCode = e.statusCode;
            error.statusMessage = e.statusMessage;
            throw error;
        }
        throw e;
    }
}

// eslint-disable-next-line require-jsdoc
async function generate(text) {
    try {
        await updateTKK();

        let tk = zr(text);
        tk = tk.replace("&tk=", "");
        return { name: "tk", value: tk };
    }
    catch (error) {
        return error;
    }
}

module.exports.generate = generate;


/***/ }),

/***/ 186:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = __webpack_require__(351);
const file_command_1 = __webpack_require__(717);
const utils_1 = __webpack_require__(278);
const os = __importStar(__webpack_require__(87));
const path = __importStar(__webpack_require__(622));
/**
 * The code to exit an action
 */
var ExitCode;
(function (ExitCode) {
    /**
     * A code indicating that the action was successful
     */
    ExitCode[ExitCode["Success"] = 0] = "Success";
    /**
     * A code indicating that the action was a failure
     */
    ExitCode[ExitCode["Failure"] = 1] = "Failure";
})(ExitCode = exports.ExitCode || (exports.ExitCode = {}));
//-----------------------------------------------------------------------
// Variables
//-----------------------------------------------------------------------
/**
 * Sets env variable for this action and future actions in the job
 * @param name the name of the variable to set
 * @param val the value of the variable. Non-string values will be converted to a string via JSON.stringify
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportVariable(name, val) {
    const convertedVal = utils_1.toCommandValue(val);
    process.env[name] = convertedVal;
    const filePath = process.env['GITHUB_ENV'] || '';
    if (filePath) {
        const delimiter = '_GitHubActionsFileCommandDelimeter_';
        const commandValue = `${name}<<${delimiter}${os.EOL}${convertedVal}${os.EOL}${delimiter}`;
        file_command_1.issueCommand('ENV', commandValue);
    }
    else {
        command_1.issueCommand('set-env', { name }, convertedVal);
    }
}
exports.exportVariable = exportVariable;
/**
 * Registers a secret which will get masked from logs
 * @param secret value of the secret
 */
function setSecret(secret) {
    command_1.issueCommand('add-mask', {}, secret);
}
exports.setSecret = setSecret;
/**
 * Prepends inputPath to the PATH (for this action and future actions)
 * @param inputPath
 */
function addPath(inputPath) {
    const filePath = process.env['GITHUB_PATH'] || '';
    if (filePath) {
        file_command_1.issueCommand('PATH', inputPath);
    }
    else {
        command_1.issueCommand('add-path', {}, inputPath);
    }
    process.env['PATH'] = `${inputPath}${path.delimiter}${process.env['PATH']}`;
}
exports.addPath = addPath;
/**
 * Gets the value of an input.  The value is also trimmed.
 *
 * @param     name     name of the input to get
 * @param     options  optional. See InputOptions.
 * @returns   string
 */
function getInput(name, options) {
    const val = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '';
    if (options && options.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return val.trim();
}
exports.getInput = getInput;
/**
 * Sets the value of an output.
 *
 * @param     name     name of the output to set
 * @param     value    value to store. Non-string values will be converted to a string via JSON.stringify
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setOutput(name, value) {
    command_1.issueCommand('set-output', { name }, value);
}
exports.setOutput = setOutput;
/**
 * Enables or disables the echoing of commands into stdout for the rest of the step.
 * Echoing is disabled by default if ACTIONS_STEP_DEBUG is not set.
 *
 */
function setCommandEcho(enabled) {
    command_1.issue('echo', enabled ? 'on' : 'off');
}
exports.setCommandEcho = setCommandEcho;
//-----------------------------------------------------------------------
// Results
//-----------------------------------------------------------------------
/**
 * Sets the action status to failed.
 * When the action exits it will be with an exit code of 1
 * @param message add error issue message
 */
function setFailed(message) {
    process.exitCode = ExitCode.Failure;
    error(message);
}
exports.setFailed = setFailed;
//-----------------------------------------------------------------------
// Logging Commands
//-----------------------------------------------------------------------
/**
 * Gets whether Actions Step Debug is on or not
 */
function isDebug() {
    return process.env['RUNNER_DEBUG'] === '1';
}
exports.isDebug = isDebug;
/**
 * Writes debug message to user log
 * @param message debug message
 */
function debug(message) {
    command_1.issueCommand('debug', {}, message);
}
exports.debug = debug;
/**
 * Adds an error issue
 * @param message error issue message. Errors will be converted to string via toString()
 */
function error(message) {
    command_1.issue('error', message instanceof Error ? message.toString() : message);
}
exports.error = error;
/**
 * Adds an warning issue
 * @param message warning issue message. Errors will be converted to string via toString()
 */
function warning(message) {
    command_1.issue('warning', message instanceof Error ? message.toString() : message);
}
exports.warning = warning;
/**
 * Writes info to log with console.log.
 * @param message info message
 */
function info(message) {
    process.stdout.write(message + os.EOL);
}
exports.info = info;
/**
 * Begin an output group.
 *
 * Output until the next `groupEnd` will be foldable in this group
 *
 * @param name The name of the output group
 */
function startGroup(name) {
    command_1.issue('group', name);
}
exports.startGroup = startGroup;
/**
 * End an output group.
 */
function endGroup() {
    command_1.issue('endgroup');
}
exports.endGroup = endGroup;
/**
 * Wrap an asynchronous function call in a group.
 *
 * Returns the same type as the function itself.
 *
 * @param name The name of the group
 * @param fn The function to wrap in the group
 */
function group(name, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        startGroup(name);
        let result;
        try {
            result = yield fn();
        }
        finally {
            endGroup();
        }
        return result;
    });
}
exports.group = group;
//-----------------------------------------------------------------------
// Wrapper action state
//-----------------------------------------------------------------------
/**
 * Saves state for current action, the state can only be retrieved by this action's post job execution.
 *
 * @param     name     name of the state to store
 * @param     value    value to store. Non-string values will be converted to a string via JSON.stringify
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function saveState(name, value) {
    command_1.issueCommand('save-state', { name }, value);
}
exports.saveState = saveState;
/**
 * Gets the value of an state set by this action's main execution.
 *
 * @param     name     name of the state to get
 * @returns   string
 */
function getState(name) {
    return process.env[`STATE_${name}`] || '';
}
exports.getState = getState;
//# sourceMappingURL=core.js.map

/***/ }),

/***/ 191:
/***/ (function(module) {

module.exports = require("querystring");

/***/ }),

/***/ 193:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

const VERSION = "2.6.0";

/**
 * Some “list” response that can be paginated have a different response structure
 *
 * They have a `total_count` key in the response (search also has `incomplete_results`,
 * /installation/repositories also has `repository_selection`), as well as a key with
 * the list of the items which name varies from endpoint to endpoint.
 *
 * Octokit normalizes these responses so that paginated results are always returned following
 * the same structure. One challenge is that if the list response has only one page, no Link
 * header is provided, so this header alone is not sufficient to check wether a response is
 * paginated or not.
 *
 * We check if a "total_count" key is present in the response data, but also make sure that
 * a "url" property is not, as the "Get the combined status for a specific ref" endpoint would
 * otherwise match: https://developer.github.com/v3/repos/statuses/#get-the-combined-status-for-a-specific-ref
 */
function normalizePaginatedListResponse(response) {
  const responseNeedsNormalization = "total_count" in response.data && !("url" in response.data);
  if (!responseNeedsNormalization) return response; // keep the additional properties intact as there is currently no other way
  // to retrieve the same information.

  const incompleteResults = response.data.incomplete_results;
  const repositorySelection = response.data.repository_selection;
  const totalCount = response.data.total_count;
  delete response.data.incomplete_results;
  delete response.data.repository_selection;
  delete response.data.total_count;
  const namespaceKey = Object.keys(response.data)[0];
  const data = response.data[namespaceKey];
  response.data = data;

  if (typeof incompleteResults !== "undefined") {
    response.data.incomplete_results = incompleteResults;
  }

  if (typeof repositorySelection !== "undefined") {
    response.data.repository_selection = repositorySelection;
  }

  response.data.total_count = totalCount;
  return response;
}

function iterator(octokit, route, parameters) {
  const options = typeof route === "function" ? route.endpoint(parameters) : octokit.request.endpoint(route, parameters);
  const requestMethod = typeof route === "function" ? route : octokit.request;
  const method = options.method;
  const headers = options.headers;
  let url = options.url;
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        if (!url) return {
          done: true
        };
        const response = await requestMethod({
          method,
          url,
          headers
        });
        const normalizedResponse = normalizePaginatedListResponse(response); // `response.headers.link` format:
        // '<https://api.github.com/users/aseemk/followers?page=2>; rel="next", <https://api.github.com/users/aseemk/followers?page=2>; rel="last"'
        // sets `url` to undefined if "next" URL is not present or `link` header is not set

        url = ((normalizedResponse.headers.link || "").match(/<([^>]+)>;\s*rel="next"/) || [])[1];
        return {
          value: normalizedResponse
        };
      }

    })
  };
}

function paginate(octokit, route, parameters, mapFn) {
  if (typeof parameters === "function") {
    mapFn = parameters;
    parameters = undefined;
  }

  return gather(octokit, [], iterator(octokit, route, parameters)[Symbol.asyncIterator](), mapFn);
}

function gather(octokit, results, iterator, mapFn) {
  return iterator.next().then(result => {
    if (result.done) {
      return results;
    }

    let earlyExit = false;

    function done() {
      earlyExit = true;
    }

    results = results.concat(mapFn ? mapFn(result.value, done) : result.value.data);

    if (earlyExit) {
      return results;
    }

    return gather(octokit, results, iterator, mapFn);
  });
}

const composePaginateRest = Object.assign(paginate, {
  iterator
});

/**
 * @param octokit Octokit instance
 * @param options Options passed to Octokit constructor
 */

function paginateRest(octokit) {
  return {
    paginate: Object.assign(paginate.bind(null, octokit), {
      iterator: iterator.bind(null, octokit)
    })
  };
}
paginateRest.VERSION = VERSION;

exports.composePaginateRest = composePaginateRest;
exports.paginateRest = paginateRest;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 199:
/***/ (function(module) {

"use strict";


module.exports = header => {
	switch (header) {
		case ':method':
		case ':scheme':
		case ':authority':
		case ':path':
			return true;
		default:
			return false;
	}
};


/***/ }),

/***/ 201:
/***/ (function(module) {

"use strict";


module.exports = collapse

// `collapse(' \t\nbar \nbaz\t') // ' bar baz '`
function collapse(value) {
  return String(value).replace(/\s+/g, ' ')
}


/***/ }),

/***/ 205:
/***/ (function(module, __unusedexports, __webpack_require__) {

var once = __webpack_require__(223);

var noop = function() {};

var isRequest = function(stream) {
	return stream.setHeader && typeof stream.abort === 'function';
};

var isChildProcess = function(stream) {
	return stream.stdio && Array.isArray(stream.stdio) && stream.stdio.length === 3
};

var eos = function(stream, opts, callback) {
	if (typeof opts === 'function') return eos(stream, null, opts);
	if (!opts) opts = {};

	callback = once(callback || noop);

	var ws = stream._writableState;
	var rs = stream._readableState;
	var readable = opts.readable || (opts.readable !== false && stream.readable);
	var writable = opts.writable || (opts.writable !== false && stream.writable);
	var cancelled = false;

	var onlegacyfinish = function() {
		if (!stream.writable) onfinish();
	};

	var onfinish = function() {
		writable = false;
		if (!readable) callback.call(stream);
	};

	var onend = function() {
		readable = false;
		if (!writable) callback.call(stream);
	};

	var onexit = function(exitCode) {
		callback.call(stream, exitCode ? new Error('exited with error code: ' + exitCode) : null);
	};

	var onerror = function(err) {
		callback.call(stream, err);
	};

	var onclose = function() {
		process.nextTick(onclosenexttick);
	};

	var onclosenexttick = function() {
		if (cancelled) return;
		if (readable && !(rs && (rs.ended && !rs.destroyed))) return callback.call(stream, new Error('premature close'));
		if (writable && !(ws && (ws.ended && !ws.destroyed))) return callback.call(stream, new Error('premature close'));
	};

	var onrequest = function() {
		stream.req.on('finish', onfinish);
	};

	if (isRequest(stream)) {
		stream.on('complete', onfinish);
		stream.on('abort', onclose);
		if (stream.req) onrequest();
		else stream.on('request', onrequest);
	} else if (writable && !ws) { // legacy streams
		stream.on('end', onlegacyfinish);
		stream.on('close', onlegacyfinish);
	}

	if (isChildProcess(stream)) stream.on('exit', onexit);

	stream.on('end', onend);
	stream.on('finish', onfinish);
	if (opts.error !== false) stream.on('error', onerror);
	stream.on('close', onclose);

	return function() {
		cancelled = true;
		stream.removeListener('complete', onfinish);
		stream.removeListener('abort', onclose);
		stream.removeListener('request', onrequest);
		if (stream.req) stream.req.removeListener('finish', onfinish);
		stream.removeListener('end', onlegacyfinish);
		stream.removeListener('close', onlegacyfinish);
		stream.removeListener('finish', onfinish);
		stream.removeListener('exit', onexit);
		stream.removeListener('end', onend);
		stream.removeListener('error', onerror);
		stream.removeListener('close', onclose);
	};
};

module.exports = eos;


/***/ }),

/***/ 211:
/***/ (function(module) {

module.exports = require("https");

/***/ }),

/***/ 214:
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const tls_1 = __webpack_require__(16);
const deferToConnect = (socket, fn) => {
    let listeners;
    if (typeof fn === 'function') {
        const connect = fn;
        listeners = { connect };
    }
    else {
        listeners = fn;
    }
    const hasConnectListener = typeof listeners.connect === 'function';
    const hasSecureConnectListener = typeof listeners.secureConnect === 'function';
    const hasCloseListener = typeof listeners.close === 'function';
    const onConnect = () => {
        if (hasConnectListener) {
            listeners.connect();
        }
        if (socket instanceof tls_1.TLSSocket && hasSecureConnectListener) {
            if (socket.authorized) {
                listeners.secureConnect();
            }
            else if (!socket.authorizationError) {
                socket.once('secureConnect', listeners.secureConnect);
            }
        }
        if (hasCloseListener) {
            socket.once('close', listeners.close);
        }
    };
    if (socket.writable && !socket.connecting) {
        onConnect();
    }
    else if (socket.connecting) {
        socket.once('connect', onConnect);
    }
    else if (socket.destroyed && hasCloseListener) {
        listeners.close(socket._hadError);
    }
};
exports.default = deferToConnect;
// For CommonJS default export support
module.exports = deferToConnect;
module.exports.default = deferToConnect;


/***/ }),

/***/ 219:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


var net = __webpack_require__(631);
var tls = __webpack_require__(16);
var http = __webpack_require__(605);
var https = __webpack_require__(211);
var events = __webpack_require__(614);
var assert = __webpack_require__(357);
var util = __webpack_require__(669);


exports.httpOverHttp = httpOverHttp;
exports.httpsOverHttp = httpsOverHttp;
exports.httpOverHttps = httpOverHttps;
exports.httpsOverHttps = httpsOverHttps;


function httpOverHttp(options) {
  var agent = new TunnelingAgent(options);
  agent.request = http.request;
  return agent;
}

function httpsOverHttp(options) {
  var agent = new TunnelingAgent(options);
  agent.request = http.request;
  agent.createSocket = createSecureSocket;
  agent.defaultPort = 443;
  return agent;
}

function httpOverHttps(options) {
  var agent = new TunnelingAgent(options);
  agent.request = https.request;
  return agent;
}

function httpsOverHttps(options) {
  var agent = new TunnelingAgent(options);
  agent.request = https.request;
  agent.createSocket = createSecureSocket;
  agent.defaultPort = 443;
  return agent;
}


function TunnelingAgent(options) {
  var self = this;
  self.options = options || {};
  self.proxyOptions = self.options.proxy || {};
  self.maxSockets = self.options.maxSockets || http.Agent.defaultMaxSockets;
  self.requests = [];
  self.sockets = [];

  self.on('free', function onFree(socket, host, port, localAddress) {
    var options = toOptions(host, port, localAddress);
    for (var i = 0, len = self.requests.length; i < len; ++i) {
      var pending = self.requests[i];
      if (pending.host === options.host && pending.port === options.port) {
        // Detect the request to connect same origin server,
        // reuse the connection.
        self.requests.splice(i, 1);
        pending.request.onSocket(socket);
        return;
      }
    }
    socket.destroy();
    self.removeSocket(socket);
  });
}
util.inherits(TunnelingAgent, events.EventEmitter);

TunnelingAgent.prototype.addRequest = function addRequest(req, host, port, localAddress) {
  var self = this;
  var options = mergeOptions({request: req}, self.options, toOptions(host, port, localAddress));

  if (self.sockets.length >= this.maxSockets) {
    // We are over limit so we'll add it to the queue.
    self.requests.push(options);
    return;
  }

  // If we are under maxSockets create a new one.
  self.createSocket(options, function(socket) {
    socket.on('free', onFree);
    socket.on('close', onCloseOrRemove);
    socket.on('agentRemove', onCloseOrRemove);
    req.onSocket(socket);

    function onFree() {
      self.emit('free', socket, options);
    }

    function onCloseOrRemove(err) {
      self.removeSocket(socket);
      socket.removeListener('free', onFree);
      socket.removeListener('close', onCloseOrRemove);
      socket.removeListener('agentRemove', onCloseOrRemove);
    }
  });
};

TunnelingAgent.prototype.createSocket = function createSocket(options, cb) {
  var self = this;
  var placeholder = {};
  self.sockets.push(placeholder);

  var connectOptions = mergeOptions({}, self.proxyOptions, {
    method: 'CONNECT',
    path: options.host + ':' + options.port,
    agent: false,
    headers: {
      host: options.host + ':' + options.port
    }
  });
  if (options.localAddress) {
    connectOptions.localAddress = options.localAddress;
  }
  if (connectOptions.proxyAuth) {
    connectOptions.headers = connectOptions.headers || {};
    connectOptions.headers['Proxy-Authorization'] = 'Basic ' +
        new Buffer(connectOptions.proxyAuth).toString('base64');
  }

  debug('making CONNECT request');
  var connectReq = self.request(connectOptions);
  connectReq.useChunkedEncodingByDefault = false; // for v0.6
  connectReq.once('response', onResponse); // for v0.6
  connectReq.once('upgrade', onUpgrade);   // for v0.6
  connectReq.once('connect', onConnect);   // for v0.7 or later
  connectReq.once('error', onError);
  connectReq.end();

  function onResponse(res) {
    // Very hacky. This is necessary to avoid http-parser leaks.
    res.upgrade = true;
  }

  function onUpgrade(res, socket, head) {
    // Hacky.
    process.nextTick(function() {
      onConnect(res, socket, head);
    });
  }

  function onConnect(res, socket, head) {
    connectReq.removeAllListeners();
    socket.removeAllListeners();

    if (res.statusCode !== 200) {
      debug('tunneling socket could not be established, statusCode=%d',
        res.statusCode);
      socket.destroy();
      var error = new Error('tunneling socket could not be established, ' +
        'statusCode=' + res.statusCode);
      error.code = 'ECONNRESET';
      options.request.emit('error', error);
      self.removeSocket(placeholder);
      return;
    }
    if (head.length > 0) {
      debug('got illegal response body from proxy');
      socket.destroy();
      var error = new Error('got illegal response body from proxy');
      error.code = 'ECONNRESET';
      options.request.emit('error', error);
      self.removeSocket(placeholder);
      return;
    }
    debug('tunneling connection has established');
    self.sockets[self.sockets.indexOf(placeholder)] = socket;
    return cb(socket);
  }

  function onError(cause) {
    connectReq.removeAllListeners();

    debug('tunneling socket could not be established, cause=%s\n',
          cause.message, cause.stack);
    var error = new Error('tunneling socket could not be established, ' +
                          'cause=' + cause.message);
    error.code = 'ECONNRESET';
    options.request.emit('error', error);
    self.removeSocket(placeholder);
  }
};

TunnelingAgent.prototype.removeSocket = function removeSocket(socket) {
  var pos = this.sockets.indexOf(socket)
  if (pos === -1) {
    return;
  }
  this.sockets.splice(pos, 1);

  var pending = this.requests.shift();
  if (pending) {
    // If we have pending requests and a socket gets closed a new one
    // needs to be created to take over in the pool for the one that closed.
    this.createSocket(pending, function(socket) {
      pending.request.onSocket(socket);
    });
  }
};

function createSecureSocket(options, cb) {
  var self = this;
  TunnelingAgent.prototype.createSocket.call(self, options, function(socket) {
    var hostHeader = options.request.getHeader('host');
    var tlsOptions = mergeOptions({}, self.options, {
      socket: socket,
      servername: hostHeader ? hostHeader.replace(/:.*$/, '') : options.host
    });

    // 0 is dummy port for v0.6
    var secureSocket = tls.connect(0, tlsOptions);
    self.sockets[self.sockets.indexOf(socket)] = secureSocket;
    cb(secureSocket);
  });
}


function toOptions(host, port, localAddress) {
  if (typeof host === 'string') { // since v0.10
    return {
      host: host,
      port: port,
      localAddress: localAddress
    };
  }
  return host; // for v0.11 or later
}

function mergeOptions(target) {
  for (var i = 1, len = arguments.length; i < len; ++i) {
    var overrides = arguments[i];
    if (typeof overrides === 'object') {
      var keys = Object.keys(overrides);
      for (var j = 0, keyLen = keys.length; j < keyLen; ++j) {
        var k = keys[j];
        if (overrides[k] !== undefined) {
          target[k] = overrides[k];
        }
      }
    }
  }
  return target;
}


var debug;
if (process.env.NODE_DEBUG && /\btunnel\b/.test(process.env.NODE_DEBUG)) {
  debug = function() {
    var args = Array.prototype.slice.call(arguments);
    if (typeof args[0] === 'string') {
      args[0] = 'TUNNEL: ' + args[0];
    } else {
      args.unshift('TUNNEL:');
    }
    console.error.apply(console, args);
  }
} else {
  debug = function() {};
}
exports.debug = debug; // for test


/***/ }),

/***/ 220:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = __webpack_require__(597);
const parseBody = (response, responseType, parseJson, encoding) => {
    const { rawBody } = response;
    try {
        if (responseType === 'text') {
            return rawBody.toString(encoding);
        }
        if (responseType === 'json') {
            return rawBody.length === 0 ? '' : parseJson(rawBody.toString());
        }
        if (responseType === 'buffer') {
            return rawBody;
        }
        throw new types_1.ParseError({
            message: `Unknown body type '${responseType}'`,
            name: 'Error'
        }, response);
    }
    catch (error) {
        throw new types_1.ParseError(error, response);
    }
};
exports.default = parseBody;


/***/ }),

/***/ 223:
/***/ (function(module, __unusedexports, __webpack_require__) {

var wrappy = __webpack_require__(940)
module.exports = wrappy(once)
module.exports.strict = wrappy(onceStrict)

once.proto = once(function () {
  Object.defineProperty(Function.prototype, 'once', {
    value: function () {
      return once(this)
    },
    configurable: true
  })

  Object.defineProperty(Function.prototype, 'onceStrict', {
    value: function () {
      return onceStrict(this)
    },
    configurable: true
  })
})

function once (fn) {
  var f = function () {
    if (f.called) return f.value
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  f.called = false
  return f
}

function onceStrict (fn) {
  var f = function () {
    if (f.called)
      throw new Error(f.onceError)
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  var name = fn.name || 'Function wrapped with `once`'
  f.onceError = name + " shouldn't be called more than once"
  f.called = false
  return f
}


/***/ }),

/***/ 234:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var endpoint = __webpack_require__(440);
var universalUserAgent = __webpack_require__(429);
var isPlainObject = __webpack_require__(62);
var nodeFetch = _interopDefault(__webpack_require__(467));
var requestError = __webpack_require__(537);

const VERSION = "5.4.10";

function getBufferResponse(response) {
  return response.arrayBuffer();
}

function fetchWrapper(requestOptions) {
  if (isPlainObject.isPlainObject(requestOptions.body) || Array.isArray(requestOptions.body)) {
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  let headers = {};
  let status;
  let url;
  const fetch = requestOptions.request && requestOptions.request.fetch || nodeFetch;
  return fetch(requestOptions.url, Object.assign({
    method: requestOptions.method,
    body: requestOptions.body,
    headers: requestOptions.headers,
    redirect: requestOptions.redirect
  }, requestOptions.request)).then(response => {
    url = response.url;
    status = response.status;

    for (const keyAndValue of response.headers) {
      headers[keyAndValue[0]] = keyAndValue[1];
    }

    if (status === 204 || status === 205) {
      return;
    } // GitHub API returns 200 for HEAD requests


    if (requestOptions.method === "HEAD") {
      if (status < 400) {
        return;
      }

      throw new requestError.RequestError(response.statusText, status, {
        headers,
        request: requestOptions
      });
    }

    if (status === 304) {
      throw new requestError.RequestError("Not modified", status, {
        headers,
        request: requestOptions
      });
    }

    if (status >= 400) {
      return response.text().then(message => {
        const error = new requestError.RequestError(message, status, {
          headers,
          request: requestOptions
        });

        try {
          let responseBody = JSON.parse(error.message);
          Object.assign(error, responseBody);
          let errors = responseBody.errors; // Assumption `errors` would always be in Array format

          error.message = error.message + ": " + errors.map(JSON.stringify).join(", ");
        } catch (e) {// ignore, see octokit/rest.js#684
        }

        throw error;
      });
    }

    const contentType = response.headers.get("content-type");

    if (/application\/json/.test(contentType)) {
      return response.json();
    }

    if (!contentType || /^text\/|charset=utf-8$/.test(contentType)) {
      return response.text();
    }

    return getBufferResponse(response);
  }).then(data => {
    return {
      status,
      url,
      headers,
      data
    };
  }).catch(error => {
    if (error instanceof requestError.RequestError) {
      throw error;
    }

    throw new requestError.RequestError(error.message, 500, {
      headers,
      request: requestOptions
    });
  });
}

function withDefaults(oldEndpoint, newDefaults) {
  const endpoint = oldEndpoint.defaults(newDefaults);

  const newApi = function (route, parameters) {
    const endpointOptions = endpoint.merge(route, parameters);

    if (!endpointOptions.request || !endpointOptions.request.hook) {
      return fetchWrapper(endpoint.parse(endpointOptions));
    }

    const request = (route, parameters) => {
      return fetchWrapper(endpoint.parse(endpoint.merge(route, parameters)));
    };

    Object.assign(request, {
      endpoint,
      defaults: withDefaults.bind(null, endpoint)
    });
    return endpointOptions.request.hook(request, endpointOptions);
  };

  return Object.assign(newApi, {
    endpoint,
    defaults: withDefaults.bind(null, endpoint)
  });
}

const request = withDefaults(endpoint.endpoint, {
  headers: {
    "user-agent": `octokit-request.js/${VERSION} ${universalUserAgent.getUserAgent()}`
  }
});

exports.request = request;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 262:
/***/ (function(module) {

"use strict";


module.exports = nGram

nGram.bigram = nGram(2)
nGram.trigram = nGram(3)

// Factory returning a function that converts a value string to n-grams.
function nGram(n) {
  if (typeof n !== 'number' || isNaN(n) || n < 1 || n === Infinity) {
    throw new Error('`' + n + '` is not a valid argument for n-gram')
  }

  return grams

  // Create n-grams from a given value.
  function grams(value) {
    var nGrams = []
    var index

    if (value === null || value === undefined) {
      return nGrams
    }

    value = value.slice ? value : String(value)
    index = value.length - n + 1

    if (index < 1) {
      return nGrams
    }

    while (index--) {
      nGrams[index] = value.slice(index, index + n)
    }

    return nGrams
  }
}


/***/ }),

/***/ 273:
/***/ (function(module) {

"use strict";


class QuickLRU {
	constructor(options = {}) {
		if (!(options.maxSize && options.maxSize > 0)) {
			throw new TypeError('`maxSize` must be a number greater than 0');
		}

		this.maxSize = options.maxSize;
		this.onEviction = options.onEviction;
		this.cache = new Map();
		this.oldCache = new Map();
		this._size = 0;
	}

	_set(key, value) {
		this.cache.set(key, value);
		this._size++;

		if (this._size >= this.maxSize) {
			this._size = 0;

			if (typeof this.onEviction === 'function') {
				for (const [key, value] of this.oldCache.entries()) {
					this.onEviction(key, value);
				}
			}

			this.oldCache = this.cache;
			this.cache = new Map();
		}
	}

	get(key) {
		if (this.cache.has(key)) {
			return this.cache.get(key);
		}

		if (this.oldCache.has(key)) {
			const value = this.oldCache.get(key);
			this.oldCache.delete(key);
			this._set(key, value);
			return value;
		}
	}

	set(key, value) {
		if (this.cache.has(key)) {
			this.cache.set(key, value);
		} else {
			this._set(key, value);
		}

		return this;
	}

	has(key) {
		return this.cache.has(key) || this.oldCache.has(key);
	}

	peek(key) {
		if (this.cache.has(key)) {
			return this.cache.get(key);
		}

		if (this.oldCache.has(key)) {
			return this.oldCache.get(key);
		}
	}

	delete(key) {
		const deleted = this.cache.delete(key);
		if (deleted) {
			this._size--;
		}

		return this.oldCache.delete(key) || deleted;
	}

	clear() {
		this.cache.clear();
		this.oldCache.clear();
		this._size = 0;
	}

	* keys() {
		for (const [key] of this) {
			yield key;
		}
	}

	* values() {
		for (const [, value] of this) {
			yield value;
		}
	}

	* [Symbol.iterator]() {
		for (const item of this.cache) {
			yield item;
		}

		for (const item of this.oldCache) {
			const [key] = item;
			if (!this.cache.has(key)) {
				yield item;
			}
		}
	}

	get size() {
		let oldCacheSize = 0;
		for (const key of this.oldCache.keys()) {
			if (!this.cache.has(key)) {
				oldCacheSize++;
			}
		}

		return Math.min(this._size + oldCacheSize, this.maxSize);
	}
}

module.exports = QuickLRU;


/***/ }),

/***/ 278:
/***/ (function(__unusedmodule, exports) {

"use strict";

// We use any as a valid input type
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Sanitizes an input into a string so it can be passed into issueCommand safely
 * @param input input to sanitize into a string
 */
function toCommandValue(input) {
    if (input === null || input === undefined) {
        return '';
    }
    else if (typeof input === 'string' || input instanceof String) {
        return input;
    }
    return JSON.stringify(input);
}
exports.toCommandValue = toCommandValue;
//# sourceMappingURL=utils.js.map

/***/ }),

/***/ 285:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const is_1 = __webpack_require__(678);
function deepFreeze(object) {
    for (const value of Object.values(object)) {
        if (is_1.default.plainObject(value) || is_1.default.array(value)) {
            deepFreeze(value);
        }
    }
    return Object.freeze(object);
}
exports.default = deepFreeze;


/***/ }),

/***/ 286:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const {
	V4MAPPED,
	ADDRCONFIG,
	ALL,
	promises: {
		Resolver: AsyncResolver
	},
	lookup: dnsLookup
} = __webpack_require__(881);
const {promisify} = __webpack_require__(669);
const os = __webpack_require__(87);

const kCacheableLookupCreateConnection = Symbol('cacheableLookupCreateConnection');
const kCacheableLookupInstance = Symbol('cacheableLookupInstance');
const kExpires = Symbol('expires');

const supportsALL = typeof ALL === 'number';

const verifyAgent = agent => {
	if (!(agent && typeof agent.createConnection === 'function')) {
		throw new Error('Expected an Agent instance as the first argument');
	}
};

const map4to6 = entries => {
	for (const entry of entries) {
		if (entry.family === 6) {
			continue;
		}

		entry.address = `::ffff:${entry.address}`;
		entry.family = 6;
	}
};

const getIfaceInfo = () => {
	let has4 = false;
	let has6 = false;

	for (const device of Object.values(os.networkInterfaces())) {
		for (const iface of device) {
			if (iface.internal) {
				continue;
			}

			if (iface.family === 'IPv6') {
				has6 = true;
			} else {
				has4 = true;
			}

			if (has4 && has6) {
				return {has4, has6};
			}
		}
	}

	return {has4, has6};
};

const isIterable = map => {
	return Symbol.iterator in map;
};

const ttl = {ttl: true};
const all = {all: true};

class CacheableLookup {
	constructor({
		cache = new Map(),
		maxTtl = Infinity,
		fallbackDuration = 3600,
		errorTtl = 0.15,
		resolver = new AsyncResolver(),
		lookup = dnsLookup
	} = {}) {
		this.maxTtl = maxTtl;
		this.errorTtl = errorTtl;

		this._cache = cache;
		this._resolver = resolver;
		this._dnsLookup = promisify(lookup);

		if (this._resolver instanceof AsyncResolver) {
			this._resolve4 = this._resolver.resolve4.bind(this._resolver);
			this._resolve6 = this._resolver.resolve6.bind(this._resolver);
		} else {
			this._resolve4 = promisify(this._resolver.resolve4.bind(this._resolver));
			this._resolve6 = promisify(this._resolver.resolve6.bind(this._resolver));
		}

		this._iface = getIfaceInfo();

		this._pending = {};
		this._nextRemovalTime = false;
		this._hostnamesToFallback = new Set();

		if (fallbackDuration < 1) {
			this._fallback = false;
		} else {
			this._fallback = true;

			const interval = setInterval(() => {
				this._hostnamesToFallback.clear();
			}, fallbackDuration * 1000);

			/* istanbul ignore next: There is no `interval.unref()` when running inside an Electron renderer */
			if (interval.unref) {
				interval.unref();
			}
		}

		this.lookup = this.lookup.bind(this);
		this.lookupAsync = this.lookupAsync.bind(this);
	}

	set servers(servers) {
		this.clear();

		this._resolver.setServers(servers);
	}

	get servers() {
		return this._resolver.getServers();
	}

	lookup(hostname, options, callback) {
		if (typeof options === 'function') {
			callback = options;
			options = {};
		} else if (typeof options === 'number') {
			options = {
				family: options
			};
		}

		if (!callback) {
			throw new Error('Callback must be a function.');
		}

		// eslint-disable-next-line promise/prefer-await-to-then
		this.lookupAsync(hostname, options).then(result => {
			if (options.all) {
				callback(null, result);
			} else {
				callback(null, result.address, result.family, result.expires, result.ttl);
			}
		}, callback);
	}

	async lookupAsync(hostname, options = {}) {
		if (typeof options === 'number') {
			options = {
				family: options
			};
		}

		let cached = await this.query(hostname);

		if (options.family === 6) {
			const filtered = cached.filter(entry => entry.family === 6);

			if (options.hints & V4MAPPED) {
				if ((supportsALL && options.hints & ALL) || filtered.length === 0) {
					map4to6(cached);
				} else {
					cached = filtered;
				}
			} else {
				cached = filtered;
			}
		} else if (options.family === 4) {
			cached = cached.filter(entry => entry.family === 4);
		}

		if (options.hints & ADDRCONFIG) {
			const {_iface} = this;
			cached = cached.filter(entry => entry.family === 6 ? _iface.has6 : _iface.has4);
		}

		if (cached.length === 0) {
			const error = new Error(`cacheableLookup ENOTFOUND ${hostname}`);
			error.code = 'ENOTFOUND';
			error.hostname = hostname;

			throw error;
		}

		if (options.all) {
			return cached;
		}

		return cached[0];
	}

	async query(hostname) {
		let cached = await this._cache.get(hostname);

		if (!cached) {
			const pending = this._pending[hostname];

			if (pending) {
				cached = await pending;
			} else {
				const newPromise = this.queryAndCache(hostname);
				this._pending[hostname] = newPromise;

				cached = await newPromise;
			}
		}

		cached = cached.map(entry => {
			return {...entry};
		});

		return cached;
	}

	async _resolve(hostname) {
		const wrap = async promise => {
			try {
				return await promise;
			} catch (error) {
				if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
					return [];
				}

				throw error;
			}
		};

		// ANY is unsafe as it doesn't trigger new queries in the underlying server.
		const [A, AAAA] = await Promise.all([
			this._resolve4(hostname, ttl),
			this._resolve6(hostname, ttl)
		].map(promise => wrap(promise)));

		let aTtl = 0;
		let aaaaTtl = 0;
		let cacheTtl = 0;

		const now = Date.now();

		for (const entry of A) {
			entry.family = 4;
			entry.expires = now + (entry.ttl * 1000);

			aTtl = Math.max(aTtl, entry.ttl);
		}

		for (const entry of AAAA) {
			entry.family = 6;
			entry.expires = now + (entry.ttl * 1000);

			aaaaTtl = Math.max(aaaaTtl, entry.ttl);
		}

		if (A.length > 0) {
			if (AAAA.length > 0) {
				cacheTtl = Math.min(aTtl, aaaaTtl);
			} else {
				cacheTtl = aTtl;
			}
		} else {
			cacheTtl = aaaaTtl;
		}

		return {
			entries: [
				...A,
				...AAAA
			],
			cacheTtl
		};
	}

	async _lookup(hostname) {
		try {
			const entries = await this._dnsLookup(hostname, {
				all: true
			});

			return {
				entries,
				cacheTtl: 0
			};
		} catch (_) {
			return {
				entries: [],
				cacheTtl: 0
			};
		}
	}

	async _set(hostname, data, cacheTtl) {
		if (this.maxTtl > 0 && cacheTtl > 0) {
			cacheTtl = Math.min(cacheTtl, this.maxTtl) * 1000;
			data[kExpires] = Date.now() + cacheTtl;

			try {
				await this._cache.set(hostname, data, cacheTtl);
			} catch (error) {
				this.lookupAsync = async () => {
					const cacheError = new Error('Cache Error. Please recreate the CacheableLookup instance.');
					cacheError.cause = error;

					throw cacheError;
				};
			}

			if (isIterable(this._cache)) {
				this._tick(cacheTtl);
			}
		}
	}

	async queryAndCache(hostname) {
		if (this._hostnamesToFallback.has(hostname)) {
			return this._dnsLookup(hostname, all);
		}

		try {
			let query = await this._resolve(hostname);

			if (query.entries.length === 0 && this._fallback) {
				query = await this._lookup(hostname);

				if (query.entries.length !== 0) {
					// Use `dns.lookup(...)` for that particular hostname
					this._hostnamesToFallback.add(hostname);
				}
			}

			const cacheTtl = query.entries.length === 0 ? this.errorTtl : query.cacheTtl;
			await this._set(hostname, query.entries, cacheTtl);

			delete this._pending[hostname];

			return query.entries;
		} catch (error) {
			delete this._pending[hostname];

			throw error;
		}
	}

	_tick(ms) {
		const nextRemovalTime = this._nextRemovalTime;

		if (!nextRemovalTime || ms < nextRemovalTime) {
			clearTimeout(this._removalTimeout);

			this._nextRemovalTime = ms;

			this._removalTimeout = setTimeout(() => {
				this._nextRemovalTime = false;

				let nextExpiry = Infinity;

				const now = Date.now();

				for (const [hostname, entries] of this._cache) {
					const expires = entries[kExpires];

					if (now >= expires) {
						this._cache.delete(hostname);
					} else if (expires < nextExpiry) {
						nextExpiry = expires;
					}
				}

				if (nextExpiry !== Infinity) {
					this._tick(nextExpiry - now);
				}
			}, ms);

			/* istanbul ignore next: There is no `timeout.unref()` when running inside an Electron renderer */
			if (this._removalTimeout.unref) {
				this._removalTimeout.unref();
			}
		}
	}

	install(agent) {
		verifyAgent(agent);

		if (kCacheableLookupCreateConnection in agent) {
			throw new Error('CacheableLookup has been already installed');
		}

		agent[kCacheableLookupCreateConnection] = agent.createConnection;
		agent[kCacheableLookupInstance] = this;

		agent.createConnection = (options, callback) => {
			if (!('lookup' in options)) {
				options.lookup = this.lookup;
			}

			return agent[kCacheableLookupCreateConnection](options, callback);
		};
	}

	uninstall(agent) {
		verifyAgent(agent);

		if (agent[kCacheableLookupCreateConnection]) {
			if (agent[kCacheableLookupInstance] !== this) {
				throw new Error('The agent is not owned by this CacheableLookup instance');
			}

			agent.createConnection = agent[kCacheableLookupCreateConnection];

			delete agent[kCacheableLookupCreateConnection];
			delete agent[kCacheableLookupInstance];
		}
	}

	updateInterfaceInfo() {
		const {_iface} = this;

		this._iface = getIfaceInfo();

		if ((_iface.has4 && !this._iface.has4) || (_iface.has6 && !this._iface.has6)) {
			this._cache.clear();
		}
	}

	clear(hostname) {
		if (hostname) {
			this._cache.delete(hostname);
			return;
		}

		this._cache.clear();
	}
}

module.exports = CacheableLookup;
module.exports.default = CacheableLookup;


/***/ }),

/***/ 288:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
class WeakableMap {
    constructor() {
        this.weakMap = new WeakMap();
        this.map = new Map();
    }
    set(key, value) {
        if (typeof key === 'object') {
            this.weakMap.set(key, value);
        }
        else {
            this.map.set(key, value);
        }
    }
    get(key) {
        if (typeof key === 'object') {
            return this.weakMap.get(key);
        }
        return this.map.get(key);
    }
    has(key) {
        if (typeof key === 'object') {
            return this.weakMap.has(key);
        }
        return this.map.has(key);
    }
}
exports.default = WeakableMap;


/***/ }),

/***/ 293:
/***/ (function(module) {

module.exports = require("buffer");

/***/ }),

/***/ 294:
/***/ (function(module, __unusedexports, __webpack_require__) {

module.exports = __webpack_require__(219);


/***/ }),

/***/ 298:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.isResponseOk = void 0;
exports.isResponseOk = (response) => {
    const { statusCode } = response;
    const limitStatusCode = response.request.options.followRedirect ? 299 : 399;
    return (statusCode >= 200 && statusCode <= limitStatusCode) || statusCode === 304;
};


/***/ }),

/***/ 312:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const PassThrough = __webpack_require__(413).PassThrough;
const mimicResponse = __webpack_require__(610);

const cloneResponse = response => {
	if (!(response && response.pipe)) {
		throw new TypeError('Parameter `response` must be a response stream.');
	}

	const clone = new PassThrough();
	mimicResponse(response, clone);

	return response.pipe(clone);
};

module.exports = cloneResponse;


/***/ }),

/***/ 323:
/***/ (function(module) {

"use strict";

/* istanbul ignore file: https://github.com/nodejs/node/blob/master/lib/internal/errors.js */

const makeError = (Base, key, getMessage) => {
	module.exports[key] = class NodeError extends Base {
		constructor(...args) {
			super(typeof getMessage === 'string' ? getMessage : getMessage(args));
			this.name = `${super.name} [${key}]`;
			this.code = key;
		}
	};
};

makeError(TypeError, 'ERR_INVALID_ARG_TYPE', args => {
	const type = args[0].includes('.') ? 'property' : 'argument';

	let valid = args[1];
	const isManyTypes = Array.isArray(valid);

	if (isManyTypes) {
		valid = `${valid.slice(0, -1).join(', ')} or ${valid.slice(-1)}`;
	}

	return `The "${args[0]}" ${type} must be ${isManyTypes ? 'one of' : 'of'} type ${valid}. Received ${typeof args[2]}`;
});

makeError(TypeError, 'ERR_INVALID_PROTOCOL', args => {
	return `Protocol "${args[0]}" not supported. Expected "${args[1]}"`;
});

makeError(Error, 'ERR_HTTP_HEADERS_SENT', args => {
	return `Cannot ${args[0]} headers after they are sent to the client`;
});

makeError(TypeError, 'ERR_INVALID_HTTP_TOKEN', args => {
	return `${args[0]} must be a valid HTTP token [${args[1]}]`;
});

makeError(TypeError, 'ERR_HTTP_INVALID_HEADER_VALUE', args => {
	return `Invalid value "${args[0]} for header "${args[1]}"`;
});

makeError(TypeError, 'ERR_INVALID_CHAR', args => {
	return `Invalid character in ${args[0]} [${args[1]}]`;
});


/***/ }),

/***/ 334:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

async function auth(token) {
  const tokenType = token.split(/\./).length === 3 ? "app" : /^v\d+\./.test(token) ? "installation" : "oauth";
  return {
    type: "token",
    token: token,
    tokenType
  };
}

/**
 * Prefix token for usage in the Authorization header
 *
 * @param token OAuth token or JSON Web Token
 */
function withAuthorizationPrefix(token) {
  if (token.split(/\./).length === 3) {
    return `bearer ${token}`;
  }

  return `token ${token}`;
}

async function hook(token, request, route, parameters) {
  const endpoint = request.endpoint.merge(route, parameters);
  endpoint.headers.authorization = withAuthorizationPrefix(token);
  return request(endpoint);
}

const createTokenAuth = function createTokenAuth(token) {
  if (!token) {
    throw new Error("[@octokit/auth-token] No token passed to createTokenAuth");
  }

  if (typeof token !== "string") {
    throw new Error("[@octokit/auth-token] Token passed to createTokenAuth is not a string");
  }

  token = token.replace(/^(token|bearer) +/i, "");
  return Object.assign(auth.bind(null, token), {
    hook: hook.bind(null, token)
  });
};

exports.createTokenAuth = createTokenAuth;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 337:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultHandler = void 0;
const is_1 = __webpack_require__(678);
const as_promise_1 = __webpack_require__(56);
const create_rejection_1 = __webpack_require__(457);
const core_1 = __webpack_require__(94);
const deep_freeze_1 = __webpack_require__(285);
const errors = {
    RequestError: as_promise_1.RequestError,
    CacheError: as_promise_1.CacheError,
    ReadError: as_promise_1.ReadError,
    HTTPError: as_promise_1.HTTPError,
    MaxRedirectsError: as_promise_1.MaxRedirectsError,
    TimeoutError: as_promise_1.TimeoutError,
    ParseError: as_promise_1.ParseError,
    CancelError: as_promise_1.CancelError,
    UnsupportedProtocolError: as_promise_1.UnsupportedProtocolError,
    UploadError: as_promise_1.UploadError
};
// The `delay` package weighs 10KB (!)
const delay = async (ms) => new Promise(resolve => {
    setTimeout(resolve, ms);
});
const { normalizeArguments } = core_1.default;
const mergeOptions = (...sources) => {
    let mergedOptions;
    for (const source of sources) {
        mergedOptions = normalizeArguments(undefined, source, mergedOptions);
    }
    return mergedOptions;
};
const getPromiseOrStream = (options) => options.isStream ? new core_1.default(undefined, options) : as_promise_1.default(options);
const isGotInstance = (value) => ('defaults' in value && 'options' in value.defaults);
const aliases = [
    'get',
    'post',
    'put',
    'patch',
    'head',
    'delete'
];
exports.defaultHandler = (options, next) => next(options);
const callInitHooks = (hooks, options) => {
    if (hooks) {
        for (const hook of hooks) {
            hook(options);
        }
    }
};
const create = (defaults) => {
    // Proxy properties from next handlers
    defaults._rawHandlers = defaults.handlers;
    defaults.handlers = defaults.handlers.map(fn => ((options, next) => {
        // This will be assigned by assigning result
        let root;
        const result = fn(options, newOptions => {
            root = next(newOptions);
            return root;
        });
        if (result !== root && !options.isStream && root) {
            const typedResult = result;
            const { then: promiseThen, catch: promiseCatch, finally: promiseFianlly } = typedResult;
            Object.setPrototypeOf(typedResult, Object.getPrototypeOf(root));
            Object.defineProperties(typedResult, Object.getOwnPropertyDescriptors(root));
            // These should point to the new promise
            // eslint-disable-next-line promise/prefer-await-to-then
            typedResult.then = promiseThen;
            typedResult.catch = promiseCatch;
            typedResult.finally = promiseFianlly;
        }
        return result;
    }));
    // Got interface
    const got = ((url, options = {}, _defaults) => {
        var _a, _b;
        let iteration = 0;
        const iterateHandlers = (newOptions) => {
            return defaults.handlers[iteration++](newOptions, iteration === defaults.handlers.length ? getPromiseOrStream : iterateHandlers);
        };
        // TODO: Remove this in Got 12.
        if (is_1.default.plainObject(url)) {
            const mergedOptions = {
                ...url,
                ...options
            };
            core_1.setNonEnumerableProperties([url, options], mergedOptions);
            options = mergedOptions;
            url = undefined;
        }
        try {
            // Call `init` hooks
            let initHookError;
            try {
                callInitHooks(defaults.options.hooks.init, options);
                callInitHooks((_a = options.hooks) === null || _a === void 0 ? void 0 : _a.init, options);
            }
            catch (error) {
                initHookError = error;
            }
            // Normalize options & call handlers
            const normalizedOptions = normalizeArguments(url, options, _defaults !== null && _defaults !== void 0 ? _defaults : defaults.options);
            normalizedOptions[core_1.kIsNormalizedAlready] = true;
            if (initHookError) {
                throw new as_promise_1.RequestError(initHookError.message, initHookError, normalizedOptions);
            }
            return iterateHandlers(normalizedOptions);
        }
        catch (error) {
            if (options.isStream) {
                throw error;
            }
            else {
                return create_rejection_1.default(error, defaults.options.hooks.beforeError, (_b = options.hooks) === null || _b === void 0 ? void 0 : _b.beforeError);
            }
        }
    });
    got.extend = (...instancesOrOptions) => {
        const optionsArray = [defaults.options];
        let handlers = [...defaults._rawHandlers];
        let isMutableDefaults;
        for (const value of instancesOrOptions) {
            if (isGotInstance(value)) {
                optionsArray.push(value.defaults.options);
                handlers.push(...value.defaults._rawHandlers);
                isMutableDefaults = value.defaults.mutableDefaults;
            }
            else {
                optionsArray.push(value);
                if ('handlers' in value) {
                    handlers.push(...value.handlers);
                }
                isMutableDefaults = value.mutableDefaults;
            }
        }
        handlers = handlers.filter(handler => handler !== exports.defaultHandler);
        if (handlers.length === 0) {
            handlers.push(exports.defaultHandler);
        }
        return create({
            options: mergeOptions(...optionsArray),
            handlers,
            mutableDefaults: Boolean(isMutableDefaults)
        });
    };
    // Pagination
    const paginateEach = (async function* (url, options) {
        // TODO: Remove this `@ts-expect-error` when upgrading to TypeScript 4.
        // Error: Argument of type 'Merge<Options, PaginationOptions<T, R>> | undefined' is not assignable to parameter of type 'Options | undefined'.
        // @ts-expect-error
        let normalizedOptions = normalizeArguments(url, options, defaults.options);
        normalizedOptions.resolveBodyOnly = false;
        const pagination = normalizedOptions.pagination;
        if (!is_1.default.object(pagination)) {
            throw new TypeError('`options.pagination` must be implemented');
        }
        const all = [];
        let { countLimit } = pagination;
        let numberOfRequests = 0;
        while (numberOfRequests < pagination.requestLimit) {
            if (numberOfRequests !== 0) {
                // eslint-disable-next-line no-await-in-loop
                await delay(pagination.backoff);
            }
            // @ts-expect-error FIXME!
            // TODO: Throw when result is not an instance of Response
            // eslint-disable-next-line no-await-in-loop
            const result = (await got(undefined, undefined, normalizedOptions));
            // eslint-disable-next-line no-await-in-loop
            const parsed = await pagination.transform(result);
            const current = [];
            for (const item of parsed) {
                if (pagination.filter(item, all, current)) {
                    if (!pagination.shouldContinue(item, all, current)) {
                        return;
                    }
                    yield item;
                    if (pagination.stackAllItems) {
                        all.push(item);
                    }
                    current.push(item);
                    if (--countLimit <= 0) {
                        return;
                    }
                }
            }
            const optionsToMerge = pagination.paginate(result, all, current);
            if (optionsToMerge === false) {
                return;
            }
            if (optionsToMerge === result.request.options) {
                normalizedOptions = result.request.options;
            }
            else if (optionsToMerge !== undefined) {
                normalizedOptions = normalizeArguments(undefined, optionsToMerge, normalizedOptions);
            }
            numberOfRequests++;
        }
    });
    got.paginate = paginateEach;
    got.paginate.all = (async (url, options) => {
        const results = [];
        for await (const item of paginateEach(url, options)) {
            results.push(item);
        }
        return results;
    });
    // For those who like very descriptive names
    got.paginate.each = paginateEach;
    // Stream API
    got.stream = ((url, options) => got(url, { ...options, isStream: true }));
    // Shortcuts
    for (const method of aliases) {
        got[method] = ((url, options) => got(url, { ...options, method }));
        got.stream[method] = ((url, options) => {
            return got(url, { ...options, method, isStream: true });
        });
    }
    Object.assign(got, errors);
    Object.defineProperty(got, 'defaults', {
        value: defaults.mutableDefaults ? defaults : deep_freeze_1.default(defaults),
        writable: defaults.mutableDefaults,
        configurable: defaults.mutableDefaults,
        enumerable: true
    });
    got.mergeOptions = mergeOptions;
    return got;
};
exports.default = create;
__exportStar(__webpack_require__(613), exports);


/***/ }),

/***/ 340:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const {PassThrough: PassThroughStream} = __webpack_require__(413);

module.exports = options => {
	options = {...options};

	const {array} = options;
	let {encoding} = options;
	const isBuffer = encoding === 'buffer';
	let objectMode = false;

	if (array) {
		objectMode = !(encoding || isBuffer);
	} else {
		encoding = encoding || 'utf8';
	}

	if (isBuffer) {
		encoding = null;
	}

	const stream = new PassThroughStream({objectMode});

	if (encoding) {
		stream.setEncoding(encoding);
	}

	let length = 0;
	const chunks = [];

	stream.on('data', chunk => {
		chunks.push(chunk);

		if (objectMode) {
			length = chunks.length;
		} else {
			length += chunk.length;
		}
	});

	stream.getBufferedValue = () => {
		if (array) {
			return chunks;
		}

		return isBuffer ? Buffer.concat(chunks, length) : chunks.join('');
	};

	stream.getBufferedLength = () => length;

	return stream;
};


/***/ }),

/***/ 341:
/***/ (function(module, __unusedexports, __webpack_require__) {

var once = __webpack_require__(223)
var eos = __webpack_require__(205)
var fs = __webpack_require__(747) // we only need fs to get the ReadStream and WriteStream prototypes

var noop = function () {}
var ancient = /^v?\.0/.test(process.version)

var isFn = function (fn) {
  return typeof fn === 'function'
}

var isFS = function (stream) {
  if (!ancient) return false // newer node version do not need to care about fs is a special way
  if (!fs) return false // browser
  return (stream instanceof (fs.ReadStream || noop) || stream instanceof (fs.WriteStream || noop)) && isFn(stream.close)
}

var isRequest = function (stream) {
  return stream.setHeader && isFn(stream.abort)
}

var destroyer = function (stream, reading, writing, callback) {
  callback = once(callback)

  var closed = false
  stream.on('close', function () {
    closed = true
  })

  eos(stream, {readable: reading, writable: writing}, function (err) {
    if (err) return callback(err)
    closed = true
    callback()
  })

  var destroyed = false
  return function (err) {
    if (closed) return
    if (destroyed) return
    destroyed = true

    if (isFS(stream)) return stream.close(noop) // use close for fs streams to avoid fd leaks
    if (isRequest(stream)) return stream.abort() // request.destroy just do .end - .abort is what we want

    if (isFn(stream.destroy)) return stream.destroy()

    callback(err || new Error('stream was destroyed'))
  }
}

var call = function (fn) {
  fn()
}

var pipe = function (from, to) {
  return from.pipe(to)
}

var pump = function () {
  var streams = Array.prototype.slice.call(arguments)
  var callback = isFn(streams[streams.length - 1] || noop) && streams.pop() || noop

  if (Array.isArray(streams[0])) streams = streams[0]
  if (streams.length < 2) throw new Error('pump requires two streams per minimum')

  var error
  var destroys = streams.map(function (stream, i) {
    var reading = i < streams.length - 1
    var writing = i > 0
    return destroyer(stream, reading, writing, function (err) {
      if (!error) error = err
      if (err) destroys.forEach(call)
      if (reading) return
      destroys.forEach(call)
      callback(error)
    })
  })

  return streams.reduce(pipe)
}

module.exports = pump


/***/ }),

/***/ 351:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const os = __importStar(__webpack_require__(87));
const utils_1 = __webpack_require__(278);
/**
 * Commands
 *
 * Command Format:
 *   ::name key=value,key=value::message
 *
 * Examples:
 *   ::warning::This is the message
 *   ::set-env name=MY_VAR::some value
 */
function issueCommand(command, properties, message) {
    const cmd = new Command(command, properties, message);
    process.stdout.write(cmd.toString() + os.EOL);
}
exports.issueCommand = issueCommand;
function issue(name, message = '') {
    issueCommand(name, {}, message);
}
exports.issue = issue;
const CMD_STRING = '::';
class Command {
    constructor(command, properties, message) {
        if (!command) {
            command = 'missing.command';
        }
        this.command = command;
        this.properties = properties;
        this.message = message;
    }
    toString() {
        let cmdStr = CMD_STRING + this.command;
        if (this.properties && Object.keys(this.properties).length > 0) {
            cmdStr += ' ';
            let first = true;
            for (const key in this.properties) {
                if (this.properties.hasOwnProperty(key)) {
                    const val = this.properties[key];
                    if (val) {
                        if (first) {
                            first = false;
                        }
                        else {
                            cmdStr += ',';
                        }
                        cmdStr += `${key}=${escapeProperty(val)}`;
                    }
                }
            }
        }
        cmdStr += `${CMD_STRING}${escapeData(this.message)}`;
        return cmdStr;
    }
}
function escapeData(s) {
    return utils_1.toCommandValue(s)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}
function escapeProperty(s) {
    return utils_1.toCommandValue(s)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}
//# sourceMappingURL=command.js.map

/***/ }),

/***/ 357:
/***/ (function(module) {

module.exports = require("assert");

/***/ }),

/***/ 391:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const {Transform, PassThrough} = __webpack_require__(413);
const zlib = __webpack_require__(761);
const mimicResponse = __webpack_require__(831);

module.exports = response => {
	const contentEncoding = (response.headers['content-encoding'] || '').toLowerCase();

	if (!['gzip', 'deflate', 'br'].includes(contentEncoding)) {
		return response;
	}

	// TODO: Remove this when targeting Node.js 12.
	const isBrotli = contentEncoding === 'br';
	if (isBrotli && typeof zlib.createBrotliDecompress !== 'function') {
		response.destroy(new Error('Brotli is not supported on Node.js < 12'));
		return response;
	}

	let isEmpty = true;

	const checker = new Transform({
		transform(data, _encoding, callback) {
			isEmpty = false;

			callback(null, data);
		},

		flush(callback) {
			callback();
		}
	});

	const finalStream = new PassThrough({
		autoDestroy: false,
		destroy(error, callback) {
			response.destroy();

			callback(error);
		}
	});

	const decompressStream = isBrotli ? zlib.createBrotliDecompress() : zlib.createUnzip();

	decompressStream.once('error', error => {
		if (isEmpty && !response.readable) {
			finalStream.end();
			return;
		}

		finalStream.destroy(error);
	});

	mimicResponse(response, finalStream);
	response.pipe(checker).pipe(decompressStream).pipe(finalStream);

	return finalStream;
};


/***/ }),

/***/ 397:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const alreadyWarned = new Set();
exports.default = (message) => {
    if (alreadyWarned.has(message)) {
        return;
    }
    alreadyWarned.add(message);
    // @ts-expect-error Missing types.
    process.emitWarning(`Got: ${message}`, {
        type: 'DeprecationWarning'
    });
};


/***/ }),

/***/ 413:
/***/ (function(module) {

module.exports = require("stream");

/***/ }),

/***/ 429:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

function getUserAgent() {
  if (typeof navigator === "object" && "userAgent" in navigator) {
    return navigator.userAgent;
  }

  if (typeof process === "object" && "version" in process) {
    return `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`;
  }

  return "<environment undetectable>";
}

exports.getUserAgent = getUserAgent;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 438:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOctokit = exports.context = void 0;
const Context = __importStar(__webpack_require__(53));
const utils_1 = __webpack_require__(30);
exports.context = new Context.Context();
/**
 * Returns a hydrated octokit ready to use for GitHub Actions
 *
 * @param     token    the repo PAT or GITHUB_TOKEN
 * @param     options  other options to set
 */
function getOctokit(token, options) {
    return new utils_1.GitHub(utils_1.getOctokitOptions(token, options));
}
exports.getOctokit = getOctokit;
//# sourceMappingURL=github.js.map

/***/ }),

/***/ 440:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

var isPlainObject = __webpack_require__(558);
var universalUserAgent = __webpack_require__(429);

function lowercaseKeys(object) {
  if (!object) {
    return {};
  }

  return Object.keys(object).reduce((newObj, key) => {
    newObj[key.toLowerCase()] = object[key];
    return newObj;
  }, {});
}

function mergeDeep(defaults, options) {
  const result = Object.assign({}, defaults);
  Object.keys(options).forEach(key => {
    if (isPlainObject.isPlainObject(options[key])) {
      if (!(key in defaults)) Object.assign(result, {
        [key]: options[key]
      });else result[key] = mergeDeep(defaults[key], options[key]);
    } else {
      Object.assign(result, {
        [key]: options[key]
      });
    }
  });
  return result;
}

function removeUndefinedProperties(obj) {
  for (const key in obj) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }

  return obj;
}

function merge(defaults, route, options) {
  if (typeof route === "string") {
    let [method, url] = route.split(" ");
    options = Object.assign(url ? {
      method,
      url
    } : {
      url: method
    }, options);
  } else {
    options = Object.assign({}, route);
  } // lowercase header names before merging with defaults to avoid duplicates


  options.headers = lowercaseKeys(options.headers); // remove properties with undefined values before merging

  removeUndefinedProperties(options);
  removeUndefinedProperties(options.headers);
  const mergedOptions = mergeDeep(defaults || {}, options); // mediaType.previews arrays are merged, instead of overwritten

  if (defaults && defaults.mediaType.previews.length) {
    mergedOptions.mediaType.previews = defaults.mediaType.previews.filter(preview => !mergedOptions.mediaType.previews.includes(preview)).concat(mergedOptions.mediaType.previews);
  }

  mergedOptions.mediaType.previews = mergedOptions.mediaType.previews.map(preview => preview.replace(/-preview/, ""));
  return mergedOptions;
}

function addQueryParameters(url, parameters) {
  const separator = /\?/.test(url) ? "&" : "?";
  const names = Object.keys(parameters);

  if (names.length === 0) {
    return url;
  }

  return url + separator + names.map(name => {
    if (name === "q") {
      return "q=" + parameters.q.split("+").map(encodeURIComponent).join("+");
    }

    return `${name}=${encodeURIComponent(parameters[name])}`;
  }).join("&");
}

const urlVariableRegex = /\{[^}]+\}/g;

function removeNonChars(variableName) {
  return variableName.replace(/^\W+|\W+$/g, "").split(/,/);
}

function extractUrlVariableNames(url) {
  const matches = url.match(urlVariableRegex);

  if (!matches) {
    return [];
  }

  return matches.map(removeNonChars).reduce((a, b) => a.concat(b), []);
}

function omit(object, keysToOmit) {
  return Object.keys(object).filter(option => !keysToOmit.includes(option)).reduce((obj, key) => {
    obj[key] = object[key];
    return obj;
  }, {});
}

// Based on https://github.com/bramstein/url-template, licensed under BSD
// TODO: create separate package.
//
// Copyright (c) 2012-2014, Bram Stein
// All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
//  1. Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
//  2. Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//  3. The name of the author may not be used to endorse or promote products
//     derived from this software without specific prior written permission.
// THIS SOFTWARE IS PROVIDED BY THE AUTHOR "AS IS" AND ANY EXPRESS OR IMPLIED
// WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
// EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
// INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
// OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
// NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
// EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/* istanbul ignore file */
function encodeReserved(str) {
  return str.split(/(%[0-9A-Fa-f]{2})/g).map(function (part) {
    if (!/%[0-9A-Fa-f]/.test(part)) {
      part = encodeURI(part).replace(/%5B/g, "[").replace(/%5D/g, "]");
    }

    return part;
  }).join("");
}

function encodeUnreserved(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function encodeValue(operator, value, key) {
  value = operator === "+" || operator === "#" ? encodeReserved(value) : encodeUnreserved(value);

  if (key) {
    return encodeUnreserved(key) + "=" + value;
  } else {
    return value;
  }
}

function isDefined(value) {
  return value !== undefined && value !== null;
}

function isKeyOperator(operator) {
  return operator === ";" || operator === "&" || operator === "?";
}

function getValues(context, operator, key, modifier) {
  var value = context[key],
      result = [];

  if (isDefined(value) && value !== "") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      value = value.toString();

      if (modifier && modifier !== "*") {
        value = value.substring(0, parseInt(modifier, 10));
      }

      result.push(encodeValue(operator, value, isKeyOperator(operator) ? key : ""));
    } else {
      if (modifier === "*") {
        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function (value) {
            result.push(encodeValue(operator, value, isKeyOperator(operator) ? key : ""));
          });
        } else {
          Object.keys(value).forEach(function (k) {
            if (isDefined(value[k])) {
              result.push(encodeValue(operator, value[k], k));
            }
          });
        }
      } else {
        const tmp = [];

        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function (value) {
            tmp.push(encodeValue(operator, value));
          });
        } else {
          Object.keys(value).forEach(function (k) {
            if (isDefined(value[k])) {
              tmp.push(encodeUnreserved(k));
              tmp.push(encodeValue(operator, value[k].toString()));
            }
          });
        }

        if (isKeyOperator(operator)) {
          result.push(encodeUnreserved(key) + "=" + tmp.join(","));
        } else if (tmp.length !== 0) {
          result.push(tmp.join(","));
        }
      }
    }
  } else {
    if (operator === ";") {
      if (isDefined(value)) {
        result.push(encodeUnreserved(key));
      }
    } else if (value === "" && (operator === "&" || operator === "?")) {
      result.push(encodeUnreserved(key) + "=");
    } else if (value === "") {
      result.push("");
    }
  }

  return result;
}

function parseUrl(template) {
  return {
    expand: expand.bind(null, template)
  };
}

function expand(template, context) {
  var operators = ["+", "#", ".", "/", ";", "?", "&"];
  return template.replace(/\{([^\{\}]+)\}|([^\{\}]+)/g, function (_, expression, literal) {
    if (expression) {
      let operator = "";
      const values = [];

      if (operators.indexOf(expression.charAt(0)) !== -1) {
        operator = expression.charAt(0);
        expression = expression.substr(1);
      }

      expression.split(/,/g).forEach(function (variable) {
        var tmp = /([^:\*]*)(?::(\d+)|(\*))?/.exec(variable);
        values.push(getValues(context, operator, tmp[1], tmp[2] || tmp[3]));
      });

      if (operator && operator !== "+") {
        var separator = ",";

        if (operator === "?") {
          separator = "&";
        } else if (operator !== "#") {
          separator = operator;
        }

        return (values.length !== 0 ? operator : "") + values.join(separator);
      } else {
        return values.join(",");
      }
    } else {
      return encodeReserved(literal);
    }
  });
}

function parse(options) {
  // https://fetch.spec.whatwg.org/#methods
  let method = options.method.toUpperCase(); // replace :varname with {varname} to make it RFC 6570 compatible

  let url = (options.url || "/").replace(/:([a-z]\w+)/g, "{$1}");
  let headers = Object.assign({}, options.headers);
  let body;
  let parameters = omit(options, ["method", "baseUrl", "url", "headers", "request", "mediaType"]); // extract variable names from URL to calculate remaining variables later

  const urlVariableNames = extractUrlVariableNames(url);
  url = parseUrl(url).expand(parameters);

  if (!/^http/.test(url)) {
    url = options.baseUrl + url;
  }

  const omittedParameters = Object.keys(options).filter(option => urlVariableNames.includes(option)).concat("baseUrl");
  const remainingParameters = omit(parameters, omittedParameters);
  const isBinaryRequest = /application\/octet-stream/i.test(headers.accept);

  if (!isBinaryRequest) {
    if (options.mediaType.format) {
      // e.g. application/vnd.github.v3+json => application/vnd.github.v3.raw
      headers.accept = headers.accept.split(/,/).map(preview => preview.replace(/application\/vnd(\.\w+)(\.v3)?(\.\w+)?(\+json)?$/, `application/vnd$1$2.${options.mediaType.format}`)).join(",");
    }

    if (options.mediaType.previews.length) {
      const previewsFromAcceptHeader = headers.accept.match(/[\w-]+(?=-preview)/g) || [];
      headers.accept = previewsFromAcceptHeader.concat(options.mediaType.previews).map(preview => {
        const format = options.mediaType.format ? `.${options.mediaType.format}` : "+json";
        return `application/vnd.github.${preview}-preview${format}`;
      }).join(",");
    }
  } // for GET/HEAD requests, set URL query parameters from remaining parameters
  // for PATCH/POST/PUT/DELETE requests, set request body from remaining parameters


  if (["GET", "HEAD"].includes(method)) {
    url = addQueryParameters(url, remainingParameters);
  } else {
    if ("data" in remainingParameters) {
      body = remainingParameters.data;
    } else {
      if (Object.keys(remainingParameters).length) {
        body = remainingParameters;
      } else {
        headers["content-length"] = 0;
      }
    }
  } // default content-type for JSON if body is set


  if (!headers["content-type"] && typeof body !== "undefined") {
    headers["content-type"] = "application/json; charset=utf-8";
  } // GitHub expects 'content-length: 0' header for PUT/PATCH requests without body.
  // fetch does not allow to set `content-length` header, but we can set body to an empty string


  if (["PATCH", "PUT"].includes(method) && typeof body === "undefined") {
    body = "";
  } // Only return body/request keys if present


  return Object.assign({
    method,
    url,
    headers
  }, typeof body !== "undefined" ? {
    body
  } : null, options.request ? {
    request: options.request
  } : null);
}

function endpointWithDefaults(defaults, route, options) {
  return parse(merge(defaults, route, options));
}

function withDefaults(oldDefaults, newDefaults) {
  const DEFAULTS = merge(oldDefaults, newDefaults);
  const endpoint = endpointWithDefaults.bind(null, DEFAULTS);
  return Object.assign(endpoint, {
    DEFAULTS,
    defaults: withDefaults.bind(null, DEFAULTS),
    merge: merge.bind(null, DEFAULTS),
    parse
  });
}

const VERSION = "6.0.9";

const userAgent = `octokit-endpoint.js/${VERSION} ${universalUserAgent.getUserAgent()}`; // DEFAULTS has all properties set that EndpointOptions has, except url.
// So we use RequestParameters and add method as additional required property.

const DEFAULTS = {
  method: "GET",
  baseUrl: "https://api.github.com",
  headers: {
    accept: "application/vnd.github.v3+json",
    "user-agent": userAgent
  },
  mediaType: {
    format: "",
    previews: []
  }
};

const endpoint = withDefaults(null, DEFAULTS);

exports.endpoint = endpoint;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 443:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
function getProxyUrl(reqUrl) {
    let usingSsl = reqUrl.protocol === 'https:';
    let proxyUrl;
    if (checkBypass(reqUrl)) {
        return proxyUrl;
    }
    let proxyVar;
    if (usingSsl) {
        proxyVar = process.env['https_proxy'] || process.env['HTTPS_PROXY'];
    }
    else {
        proxyVar = process.env['http_proxy'] || process.env['HTTP_PROXY'];
    }
    if (proxyVar) {
        proxyUrl = new URL(proxyVar);
    }
    return proxyUrl;
}
exports.getProxyUrl = getProxyUrl;
function checkBypass(reqUrl) {
    if (!reqUrl.hostname) {
        return false;
    }
    let noProxy = process.env['no_proxy'] || process.env['NO_PROXY'] || '';
    if (!noProxy) {
        return false;
    }
    // Determine the request port
    let reqPort;
    if (reqUrl.port) {
        reqPort = Number(reqUrl.port);
    }
    else if (reqUrl.protocol === 'http:') {
        reqPort = 80;
    }
    else if (reqUrl.protocol === 'https:') {
        reqPort = 443;
    }
    // Format the request hostname and hostname with port
    let upperReqHosts = [reqUrl.hostname.toUpperCase()];
    if (typeof reqPort === 'number') {
        upperReqHosts.push(`${upperReqHosts[0]}:${reqPort}`);
    }
    // Compare request host against noproxy
    for (let upperNoProxyItem of noProxy
        .split(',')
        .map(x => x.trim().toUpperCase())
        .filter(x => x)) {
        if (upperReqHosts.some(x => x === upperNoProxyItem)) {
            return true;
        }
    }
    return false;
}
exports.checkBypass = checkBypass;


/***/ }),

/***/ 454:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutError = void 0;
const net = __webpack_require__(631);
const unhandle_1 = __webpack_require__(593);
const reentry = Symbol('reentry');
const noop = () => { };
class TimeoutError extends Error {
    constructor(threshold, event) {
        super(`Timeout awaiting '${event}' for ${threshold}ms`);
        this.event = event;
        this.name = 'TimeoutError';
        this.code = 'ETIMEDOUT';
    }
}
exports.TimeoutError = TimeoutError;
exports.default = (request, delays, options) => {
    if (reentry in request) {
        return noop;
    }
    request[reentry] = true;
    const cancelers = [];
    const { once, unhandleAll } = unhandle_1.default();
    const addTimeout = (delay, callback, event) => {
        var _a;
        const timeout = setTimeout(callback, delay, delay, event);
        (_a = timeout.unref) === null || _a === void 0 ? void 0 : _a.call(timeout);
        const cancel = () => {
            clearTimeout(timeout);
        };
        cancelers.push(cancel);
        return cancel;
    };
    const { host, hostname } = options;
    const timeoutHandler = (delay, event) => {
        request.destroy(new TimeoutError(delay, event));
    };
    const cancelTimeouts = () => {
        for (const cancel of cancelers) {
            cancel();
        }
        unhandleAll();
    };
    request.once('error', error => {
        cancelTimeouts();
        // Save original behavior
        /* istanbul ignore next */
        if (request.listenerCount('error') === 0) {
            throw error;
        }
    });
    request.once('close', cancelTimeouts);
    once(request, 'response', (response) => {
        once(response, 'end', cancelTimeouts);
    });
    if (typeof delays.request !== 'undefined') {
        addTimeout(delays.request, timeoutHandler, 'request');
    }
    if (typeof delays.socket !== 'undefined') {
        const socketTimeoutHandler = () => {
            timeoutHandler(delays.socket, 'socket');
        };
        request.setTimeout(delays.socket, socketTimeoutHandler);
        // `request.setTimeout(0)` causes a memory leak.
        // We can just remove the listener and forget about the timer - it's unreffed.
        // See https://github.com/sindresorhus/got/issues/690
        cancelers.push(() => {
            request.removeListener('timeout', socketTimeoutHandler);
        });
    }
    once(request, 'socket', (socket) => {
        var _a;
        const { socketPath } = request;
        /* istanbul ignore next: hard to test */
        if (socket.connecting) {
            const hasPath = Boolean(socketPath !== null && socketPath !== void 0 ? socketPath : net.isIP((_a = hostname !== null && hostname !== void 0 ? hostname : host) !== null && _a !== void 0 ? _a : '') !== 0);
            if (typeof delays.lookup !== 'undefined' && !hasPath && typeof socket.address().address === 'undefined') {
                const cancelTimeout = addTimeout(delays.lookup, timeoutHandler, 'lookup');
                once(socket, 'lookup', cancelTimeout);
            }
            if (typeof delays.connect !== 'undefined') {
                const timeConnect = () => addTimeout(delays.connect, timeoutHandler, 'connect');
                if (hasPath) {
                    once(socket, 'connect', timeConnect());
                }
                else {
                    once(socket, 'lookup', (error) => {
                        if (error === null) {
                            once(socket, 'connect', timeConnect());
                        }
                    });
                }
            }
            if (typeof delays.secureConnect !== 'undefined' && options.protocol === 'https:') {
                once(socket, 'connect', () => {
                    const cancelTimeout = addTimeout(delays.secureConnect, timeoutHandler, 'secureConnect');
                    once(socket, 'secureConnect', cancelTimeout);
                });
            }
        }
        if (typeof delays.send !== 'undefined') {
            const timeRequest = () => addTimeout(delays.send, timeoutHandler, 'send');
            /* istanbul ignore next: hard to test */
            if (socket.connecting) {
                once(socket, 'connect', () => {
                    once(request, 'upload-complete', timeRequest());
                });
            }
            else {
                once(request, 'upload-complete', timeRequest());
            }
        }
    });
    if (typeof delays.response !== 'undefined') {
        once(request, 'upload-complete', () => {
            const cancelTimeout = addTimeout(delays.response, timeoutHandler, 'response');
            once(request, 'response', cancelTimeout);
        });
    }
    return cancelTimeouts;
};


/***/ }),

/***/ 457:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = __webpack_require__(597);
function createRejection(error, ...beforeErrorGroups) {
    const promise = (async () => {
        if (error instanceof types_1.RequestError) {
            try {
                for (const hooks of beforeErrorGroups) {
                    if (hooks) {
                        for (const hook of hooks) {
                            // eslint-disable-next-line no-await-in-loop
                            error = await hook(error);
                        }
                    }
                }
            }
            catch (error_) {
                error = error_;
            }
        }
        throw error;
    })();
    const returnPromise = () => promise;
    promise.json = returnPromise;
    promise.text = returnPromise;
    promise.buffer = returnPromise;
    promise.on = returnPromise;
    return promise;
}
exports.default = createRejection;


/***/ }),

/***/ 462:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.retryAfterStatusCodes = void 0;
exports.retryAfterStatusCodes = new Set([413, 429, 503]);
const calculateRetryDelay = ({ attemptCount, retryOptions, error, retryAfter }) => {
    if (attemptCount > retryOptions.limit) {
        return 0;
    }
    const hasMethod = retryOptions.methods.includes(error.options.method);
    const hasErrorCode = retryOptions.errorCodes.includes(error.code);
    const hasStatusCode = error.response && retryOptions.statusCodes.includes(error.response.statusCode);
    if (!hasMethod || (!hasErrorCode && !hasStatusCode)) {
        return 0;
    }
    if (error.response) {
        if (retryAfter) {
            if (retryOptions.maxRetryAfter === undefined || retryAfter > retryOptions.maxRetryAfter) {
                return 0;
            }
            return retryAfter;
        }
        if (error.response.statusCode === 413) {
            return 0;
        }
    }
    const noise = Math.random() * 100;
    return ((2 ** (attemptCount - 1)) * 1000) + noise;
};
exports.default = calculateRetryDelay;


/***/ }),

/***/ 467:
/***/ (function(module, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Stream = _interopDefault(__webpack_require__(413));
var http = _interopDefault(__webpack_require__(605));
var Url = _interopDefault(__webpack_require__(835));
var https = _interopDefault(__webpack_require__(211));
var zlib = _interopDefault(__webpack_require__(761));

// Based on https://github.com/tmpvar/jsdom/blob/aa85b2abf07766ff7bf5c1f6daafb3726f2f2db5/lib/jsdom/living/blob.js

// fix for "Readable" isn't a named export issue
const Readable = Stream.Readable;

const BUFFER = Symbol('buffer');
const TYPE = Symbol('type');

class Blob {
	constructor() {
		this[TYPE] = '';

		const blobParts = arguments[0];
		const options = arguments[1];

		const buffers = [];
		let size = 0;

		if (blobParts) {
			const a = blobParts;
			const length = Number(a.length);
			for (let i = 0; i < length; i++) {
				const element = a[i];
				let buffer;
				if (element instanceof Buffer) {
					buffer = element;
				} else if (ArrayBuffer.isView(element)) {
					buffer = Buffer.from(element.buffer, element.byteOffset, element.byteLength);
				} else if (element instanceof ArrayBuffer) {
					buffer = Buffer.from(element);
				} else if (element instanceof Blob) {
					buffer = element[BUFFER];
				} else {
					buffer = Buffer.from(typeof element === 'string' ? element : String(element));
				}
				size += buffer.length;
				buffers.push(buffer);
			}
		}

		this[BUFFER] = Buffer.concat(buffers);

		let type = options && options.type !== undefined && String(options.type).toLowerCase();
		if (type && !/[^\u0020-\u007E]/.test(type)) {
			this[TYPE] = type;
		}
	}
	get size() {
		return this[BUFFER].length;
	}
	get type() {
		return this[TYPE];
	}
	text() {
		return Promise.resolve(this[BUFFER].toString());
	}
	arrayBuffer() {
		const buf = this[BUFFER];
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		return Promise.resolve(ab);
	}
	stream() {
		const readable = new Readable();
		readable._read = function () {};
		readable.push(this[BUFFER]);
		readable.push(null);
		return readable;
	}
	toString() {
		return '[object Blob]';
	}
	slice() {
		const size = this.size;

		const start = arguments[0];
		const end = arguments[1];
		let relativeStart, relativeEnd;
		if (start === undefined) {
			relativeStart = 0;
		} else if (start < 0) {
			relativeStart = Math.max(size + start, 0);
		} else {
			relativeStart = Math.min(start, size);
		}
		if (end === undefined) {
			relativeEnd = size;
		} else if (end < 0) {
			relativeEnd = Math.max(size + end, 0);
		} else {
			relativeEnd = Math.min(end, size);
		}
		const span = Math.max(relativeEnd - relativeStart, 0);

		const buffer = this[BUFFER];
		const slicedBuffer = buffer.slice(relativeStart, relativeStart + span);
		const blob = new Blob([], { type: arguments[2] });
		blob[BUFFER] = slicedBuffer;
		return blob;
	}
}

Object.defineProperties(Blob.prototype, {
	size: { enumerable: true },
	type: { enumerable: true },
	slice: { enumerable: true }
});

Object.defineProperty(Blob.prototype, Symbol.toStringTag, {
	value: 'Blob',
	writable: false,
	enumerable: false,
	configurable: true
});

/**
 * fetch-error.js
 *
 * FetchError interface for operational errors
 */

/**
 * Create FetchError instance
 *
 * @param   String      message      Error message for human
 * @param   String      type         Error type for machine
 * @param   String      systemError  For Node.js system error
 * @return  FetchError
 */
function FetchError(message, type, systemError) {
  Error.call(this, message);

  this.message = message;
  this.type = type;

  // when err.type is `system`, err.code contains system error code
  if (systemError) {
    this.code = this.errno = systemError.code;
  }

  // hide custom error implementation details from end-users
  Error.captureStackTrace(this, this.constructor);
}

FetchError.prototype = Object.create(Error.prototype);
FetchError.prototype.constructor = FetchError;
FetchError.prototype.name = 'FetchError';

let convert;
try {
	convert = __webpack_require__(877).convert;
} catch (e) {}

const INTERNALS = Symbol('Body internals');

// fix an issue where "PassThrough" isn't a named export for node <10
const PassThrough = Stream.PassThrough;

/**
 * Body mixin
 *
 * Ref: https://fetch.spec.whatwg.org/#body
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
function Body(body) {
	var _this = this;

	var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
	    _ref$size = _ref.size;

	let size = _ref$size === undefined ? 0 : _ref$size;
	var _ref$timeout = _ref.timeout;
	let timeout = _ref$timeout === undefined ? 0 : _ref$timeout;

	if (body == null) {
		// body is undefined or null
		body = null;
	} else if (isURLSearchParams(body)) {
		// body is a URLSearchParams
		body = Buffer.from(body.toString());
	} else if (isBlob(body)) ; else if (Buffer.isBuffer(body)) ; else if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
		// body is ArrayBuffer
		body = Buffer.from(body);
	} else if (ArrayBuffer.isView(body)) {
		// body is ArrayBufferView
		body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	} else if (body instanceof Stream) ; else {
		// none of the above
		// coerce to string then buffer
		body = Buffer.from(String(body));
	}
	this[INTERNALS] = {
		body,
		disturbed: false,
		error: null
	};
	this.size = size;
	this.timeout = timeout;

	if (body instanceof Stream) {
		body.on('error', function (err) {
			const error = err.name === 'AbortError' ? err : new FetchError(`Invalid response body while trying to fetch ${_this.url}: ${err.message}`, 'system', err);
			_this[INTERNALS].error = error;
		});
	}
}

Body.prototype = {
	get body() {
		return this[INTERNALS].body;
	},

	get bodyUsed() {
		return this[INTERNALS].disturbed;
	},

	/**
  * Decode response as ArrayBuffer
  *
  * @return  Promise
  */
	arrayBuffer() {
		return consumeBody.call(this).then(function (buf) {
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		});
	},

	/**
  * Return raw response as Blob
  *
  * @return Promise
  */
	blob() {
		let ct = this.headers && this.headers.get('content-type') || '';
		return consumeBody.call(this).then(function (buf) {
			return Object.assign(
			// Prevent copying
			new Blob([], {
				type: ct.toLowerCase()
			}), {
				[BUFFER]: buf
			});
		});
	},

	/**
  * Decode response as json
  *
  * @return  Promise
  */
	json() {
		var _this2 = this;

		return consumeBody.call(this).then(function (buffer) {
			try {
				return JSON.parse(buffer.toString());
			} catch (err) {
				return Body.Promise.reject(new FetchError(`invalid json response body at ${_this2.url} reason: ${err.message}`, 'invalid-json'));
			}
		});
	},

	/**
  * Decode response as text
  *
  * @return  Promise
  */
	text() {
		return consumeBody.call(this).then(function (buffer) {
			return buffer.toString();
		});
	},

	/**
  * Decode response as buffer (non-spec api)
  *
  * @return  Promise
  */
	buffer() {
		return consumeBody.call(this);
	},

	/**
  * Decode response as text, while automatically detecting the encoding and
  * trying to decode to UTF-8 (non-spec api)
  *
  * @return  Promise
  */
	textConverted() {
		var _this3 = this;

		return consumeBody.call(this).then(function (buffer) {
			return convertBody(buffer, _this3.headers);
		});
	}
};

// In browsers, all properties are enumerable.
Object.defineProperties(Body.prototype, {
	body: { enumerable: true },
	bodyUsed: { enumerable: true },
	arrayBuffer: { enumerable: true },
	blob: { enumerable: true },
	json: { enumerable: true },
	text: { enumerable: true }
});

Body.mixIn = function (proto) {
	for (const name of Object.getOwnPropertyNames(Body.prototype)) {
		// istanbul ignore else: future proof
		if (!(name in proto)) {
			const desc = Object.getOwnPropertyDescriptor(Body.prototype, name);
			Object.defineProperty(proto, name, desc);
		}
	}
};

/**
 * Consume and convert an entire Body to a Buffer.
 *
 * Ref: https://fetch.spec.whatwg.org/#concept-body-consume-body
 *
 * @return  Promise
 */
function consumeBody() {
	var _this4 = this;

	if (this[INTERNALS].disturbed) {
		return Body.Promise.reject(new TypeError(`body used already for: ${this.url}`));
	}

	this[INTERNALS].disturbed = true;

	if (this[INTERNALS].error) {
		return Body.Promise.reject(this[INTERNALS].error);
	}

	let body = this.body;

	// body is null
	if (body === null) {
		return Body.Promise.resolve(Buffer.alloc(0));
	}

	// body is blob
	if (isBlob(body)) {
		body = body.stream();
	}

	// body is buffer
	if (Buffer.isBuffer(body)) {
		return Body.Promise.resolve(body);
	}

	// istanbul ignore if: should never happen
	if (!(body instanceof Stream)) {
		return Body.Promise.resolve(Buffer.alloc(0));
	}

	// body is stream
	// get ready to actually consume the body
	let accum = [];
	let accumBytes = 0;
	let abort = false;

	return new Body.Promise(function (resolve, reject) {
		let resTimeout;

		// allow timeout on slow response body
		if (_this4.timeout) {
			resTimeout = setTimeout(function () {
				abort = true;
				reject(new FetchError(`Response timeout while trying to fetch ${_this4.url} (over ${_this4.timeout}ms)`, 'body-timeout'));
			}, _this4.timeout);
		}

		// handle stream errors
		body.on('error', function (err) {
			if (err.name === 'AbortError') {
				// if the request was aborted, reject with this Error
				abort = true;
				reject(err);
			} else {
				// other errors, such as incorrect content-encoding
				reject(new FetchError(`Invalid response body while trying to fetch ${_this4.url}: ${err.message}`, 'system', err));
			}
		});

		body.on('data', function (chunk) {
			if (abort || chunk === null) {
				return;
			}

			if (_this4.size && accumBytes + chunk.length > _this4.size) {
				abort = true;
				reject(new FetchError(`content size at ${_this4.url} over limit: ${_this4.size}`, 'max-size'));
				return;
			}

			accumBytes += chunk.length;
			accum.push(chunk);
		});

		body.on('end', function () {
			if (abort) {
				return;
			}

			clearTimeout(resTimeout);

			try {
				resolve(Buffer.concat(accum, accumBytes));
			} catch (err) {
				// handle streams that have accumulated too much data (issue #414)
				reject(new FetchError(`Could not create Buffer from response body for ${_this4.url}: ${err.message}`, 'system', err));
			}
		});
	});
}

/**
 * Detect buffer encoding and convert to target encoding
 * ref: http://www.w3.org/TR/2011/WD-html5-20110113/parsing.html#determining-the-character-encoding
 *
 * @param   Buffer  buffer    Incoming buffer
 * @param   String  encoding  Target encoding
 * @return  String
 */
function convertBody(buffer, headers) {
	if (typeof convert !== 'function') {
		throw new Error('The package `encoding` must be installed to use the textConverted() function');
	}

	const ct = headers.get('content-type');
	let charset = 'utf-8';
	let res, str;

	// header
	if (ct) {
		res = /charset=([^;]*)/i.exec(ct);
	}

	// no charset in content type, peek at response body for at most 1024 bytes
	str = buffer.slice(0, 1024).toString();

	// html5
	if (!res && str) {
		res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
	}

	// html4
	if (!res && str) {
		res = /<meta[\s]+?http-equiv=(['"])content-type\1[\s]+?content=(['"])(.+?)\2/i.exec(str);
		if (!res) {
			res = /<meta[\s]+?content=(['"])(.+?)\1[\s]+?http-equiv=(['"])content-type\3/i.exec(str);
			if (res) {
				res.pop(); // drop last quote
			}
		}

		if (res) {
			res = /charset=(.*)/i.exec(res.pop());
		}
	}

	// xml
	if (!res && str) {
		res = /<\?xml.+?encoding=(['"])(.+?)\1/i.exec(str);
	}

	// found charset
	if (res) {
		charset = res.pop();

		// prevent decode issues when sites use incorrect encoding
		// ref: https://hsivonen.fi/encoding-menu/
		if (charset === 'gb2312' || charset === 'gbk') {
			charset = 'gb18030';
		}
	}

	// turn raw buffers into a single utf-8 buffer
	return convert(buffer, 'UTF-8', charset).toString();
}

/**
 * Detect a URLSearchParams object
 * ref: https://github.com/bitinn/node-fetch/issues/296#issuecomment-307598143
 *
 * @param   Object  obj     Object to detect by type or brand
 * @return  String
 */
function isURLSearchParams(obj) {
	// Duck-typing as a necessary condition.
	if (typeof obj !== 'object' || typeof obj.append !== 'function' || typeof obj.delete !== 'function' || typeof obj.get !== 'function' || typeof obj.getAll !== 'function' || typeof obj.has !== 'function' || typeof obj.set !== 'function') {
		return false;
	}

	// Brand-checking and more duck-typing as optional condition.
	return obj.constructor.name === 'URLSearchParams' || Object.prototype.toString.call(obj) === '[object URLSearchParams]' || typeof obj.sort === 'function';
}

/**
 * Check if `obj` is a W3C `Blob` object (which `File` inherits from)
 * @param  {*} obj
 * @return {boolean}
 */
function isBlob(obj) {
	return typeof obj === 'object' && typeof obj.arrayBuffer === 'function' && typeof obj.type === 'string' && typeof obj.stream === 'function' && typeof obj.constructor === 'function' && typeof obj.constructor.name === 'string' && /^(Blob|File)$/.test(obj.constructor.name) && /^(Blob|File)$/.test(obj[Symbol.toStringTag]);
}

/**
 * Clone body given Res/Req instance
 *
 * @param   Mixed  instance  Response or Request instance
 * @return  Mixed
 */
function clone(instance) {
	let p1, p2;
	let body = instance.body;

	// don't allow cloning a used body
	if (instance.bodyUsed) {
		throw new Error('cannot clone body after it is used');
	}

	// check that body is a stream and not form-data object
	// note: we can't clone the form-data object without having it as a dependency
	if (body instanceof Stream && typeof body.getBoundary !== 'function') {
		// tee instance body
		p1 = new PassThrough();
		p2 = new PassThrough();
		body.pipe(p1);
		body.pipe(p2);
		// set instance body to teed body and return the other teed body
		instance[INTERNALS].body = p1;
		body = p2;
	}

	return body;
}

/**
 * Performs the operation "extract a `Content-Type` value from |object|" as
 * specified in the specification:
 * https://fetch.spec.whatwg.org/#concept-bodyinit-extract
 *
 * This function assumes that instance.body is present.
 *
 * @param   Mixed  instance  Any options.body input
 */
function extractContentType(body) {
	if (body === null) {
		// body is null
		return null;
	} else if (typeof body === 'string') {
		// body is string
		return 'text/plain;charset=UTF-8';
	} else if (isURLSearchParams(body)) {
		// body is a URLSearchParams
		return 'application/x-www-form-urlencoded;charset=UTF-8';
	} else if (isBlob(body)) {
		// body is blob
		return body.type || null;
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		return null;
	} else if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
		// body is ArrayBuffer
		return null;
	} else if (ArrayBuffer.isView(body)) {
		// body is ArrayBufferView
		return null;
	} else if (typeof body.getBoundary === 'function') {
		// detect form data input from form-data module
		return `multipart/form-data;boundary=${body.getBoundary()}`;
	} else if (body instanceof Stream) {
		// body is stream
		// can't really do much about this
		return null;
	} else {
		// Body constructor defaults other things to string
		return 'text/plain;charset=UTF-8';
	}
}

/**
 * The Fetch Standard treats this as if "total bytes" is a property on the body.
 * For us, we have to explicitly get it with a function.
 *
 * ref: https://fetch.spec.whatwg.org/#concept-body-total-bytes
 *
 * @param   Body    instance   Instance of Body
 * @return  Number?            Number of bytes, or null if not possible
 */
function getTotalBytes(instance) {
	const body = instance.body;


	if (body === null) {
		// body is null
		return 0;
	} else if (isBlob(body)) {
		return body.size;
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		return body.length;
	} else if (body && typeof body.getLengthSync === 'function') {
		// detect form data input from form-data module
		if (body._lengthRetrievers && body._lengthRetrievers.length == 0 || // 1.x
		body.hasKnownLength && body.hasKnownLength()) {
			// 2.x
			return body.getLengthSync();
		}
		return null;
	} else {
		// body is stream
		return null;
	}
}

/**
 * Write a Body to a Node.js WritableStream (e.g. http.Request) object.
 *
 * @param   Body    instance   Instance of Body
 * @return  Void
 */
function writeToStream(dest, instance) {
	const body = instance.body;


	if (body === null) {
		// body is null
		dest.end();
	} else if (isBlob(body)) {
		body.stream().pipe(dest);
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		dest.write(body);
		dest.end();
	} else {
		// body is stream
		body.pipe(dest);
	}
}

// expose Promise
Body.Promise = global.Promise;

/**
 * headers.js
 *
 * Headers class offers convenient helpers
 */

const invalidTokenRegex = /[^\^_`a-zA-Z\-0-9!#$%&'*+.|~]/;
const invalidHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/;

function validateName(name) {
	name = `${name}`;
	if (invalidTokenRegex.test(name) || name === '') {
		throw new TypeError(`${name} is not a legal HTTP header name`);
	}
}

function validateValue(value) {
	value = `${value}`;
	if (invalidHeaderCharRegex.test(value)) {
		throw new TypeError(`${value} is not a legal HTTP header value`);
	}
}

/**
 * Find the key in the map object given a header name.
 *
 * Returns undefined if not found.
 *
 * @param   String  name  Header name
 * @return  String|Undefined
 */
function find(map, name) {
	name = name.toLowerCase();
	for (const key in map) {
		if (key.toLowerCase() === name) {
			return key;
		}
	}
	return undefined;
}

const MAP = Symbol('map');
class Headers {
	/**
  * Headers class
  *
  * @param   Object  headers  Response headers
  * @return  Void
  */
	constructor() {
		let init = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : undefined;

		this[MAP] = Object.create(null);

		if (init instanceof Headers) {
			const rawHeaders = init.raw();
			const headerNames = Object.keys(rawHeaders);

			for (const headerName of headerNames) {
				for (const value of rawHeaders[headerName]) {
					this.append(headerName, value);
				}
			}

			return;
		}

		// We don't worry about converting prop to ByteString here as append()
		// will handle it.
		if (init == null) ; else if (typeof init === 'object') {
			const method = init[Symbol.iterator];
			if (method != null) {
				if (typeof method !== 'function') {
					throw new TypeError('Header pairs must be iterable');
				}

				// sequence<sequence<ByteString>>
				// Note: per spec we have to first exhaust the lists then process them
				const pairs = [];
				for (const pair of init) {
					if (typeof pair !== 'object' || typeof pair[Symbol.iterator] !== 'function') {
						throw new TypeError('Each header pair must be iterable');
					}
					pairs.push(Array.from(pair));
				}

				for (const pair of pairs) {
					if (pair.length !== 2) {
						throw new TypeError('Each header pair must be a name/value tuple');
					}
					this.append(pair[0], pair[1]);
				}
			} else {
				// record<ByteString, ByteString>
				for (const key of Object.keys(init)) {
					const value = init[key];
					this.append(key, value);
				}
			}
		} else {
			throw new TypeError('Provided initializer must be an object');
		}
	}

	/**
  * Return combined header value given name
  *
  * @param   String  name  Header name
  * @return  Mixed
  */
	get(name) {
		name = `${name}`;
		validateName(name);
		const key = find(this[MAP], name);
		if (key === undefined) {
			return null;
		}

		return this[MAP][key].join(', ');
	}

	/**
  * Iterate over all headers
  *
  * @param   Function  callback  Executed for each item with parameters (value, name, thisArg)
  * @param   Boolean   thisArg   `this` context for callback function
  * @return  Void
  */
	forEach(callback) {
		let thisArg = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : undefined;

		let pairs = getHeaders(this);
		let i = 0;
		while (i < pairs.length) {
			var _pairs$i = pairs[i];
			const name = _pairs$i[0],
			      value = _pairs$i[1];

			callback.call(thisArg, value, name, this);
			pairs = getHeaders(this);
			i++;
		}
	}

	/**
  * Overwrite header values given name
  *
  * @param   String  name   Header name
  * @param   String  value  Header value
  * @return  Void
  */
	set(name, value) {
		name = `${name}`;
		value = `${value}`;
		validateName(name);
		validateValue(value);
		const key = find(this[MAP], name);
		this[MAP][key !== undefined ? key : name] = [value];
	}

	/**
  * Append a value onto existing header
  *
  * @param   String  name   Header name
  * @param   String  value  Header value
  * @return  Void
  */
	append(name, value) {
		name = `${name}`;
		value = `${value}`;
		validateName(name);
		validateValue(value);
		const key = find(this[MAP], name);
		if (key !== undefined) {
			this[MAP][key].push(value);
		} else {
			this[MAP][name] = [value];
		}
	}

	/**
  * Check for header name existence
  *
  * @param   String   name  Header name
  * @return  Boolean
  */
	has(name) {
		name = `${name}`;
		validateName(name);
		return find(this[MAP], name) !== undefined;
	}

	/**
  * Delete all header values given name
  *
  * @param   String  name  Header name
  * @return  Void
  */
	delete(name) {
		name = `${name}`;
		validateName(name);
		const key = find(this[MAP], name);
		if (key !== undefined) {
			delete this[MAP][key];
		}
	}

	/**
  * Return raw headers (non-spec api)
  *
  * @return  Object
  */
	raw() {
		return this[MAP];
	}

	/**
  * Get an iterator on keys.
  *
  * @return  Iterator
  */
	keys() {
		return createHeadersIterator(this, 'key');
	}

	/**
  * Get an iterator on values.
  *
  * @return  Iterator
  */
	values() {
		return createHeadersIterator(this, 'value');
	}

	/**
  * Get an iterator on entries.
  *
  * This is the default iterator of the Headers object.
  *
  * @return  Iterator
  */
	[Symbol.iterator]() {
		return createHeadersIterator(this, 'key+value');
	}
}
Headers.prototype.entries = Headers.prototype[Symbol.iterator];

Object.defineProperty(Headers.prototype, Symbol.toStringTag, {
	value: 'Headers',
	writable: false,
	enumerable: false,
	configurable: true
});

Object.defineProperties(Headers.prototype, {
	get: { enumerable: true },
	forEach: { enumerable: true },
	set: { enumerable: true },
	append: { enumerable: true },
	has: { enumerable: true },
	delete: { enumerable: true },
	keys: { enumerable: true },
	values: { enumerable: true },
	entries: { enumerable: true }
});

function getHeaders(headers) {
	let kind = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'key+value';

	const keys = Object.keys(headers[MAP]).sort();
	return keys.map(kind === 'key' ? function (k) {
		return k.toLowerCase();
	} : kind === 'value' ? function (k) {
		return headers[MAP][k].join(', ');
	} : function (k) {
		return [k.toLowerCase(), headers[MAP][k].join(', ')];
	});
}

const INTERNAL = Symbol('internal');

function createHeadersIterator(target, kind) {
	const iterator = Object.create(HeadersIteratorPrototype);
	iterator[INTERNAL] = {
		target,
		kind,
		index: 0
	};
	return iterator;
}

const HeadersIteratorPrototype = Object.setPrototypeOf({
	next() {
		// istanbul ignore if
		if (!this || Object.getPrototypeOf(this) !== HeadersIteratorPrototype) {
			throw new TypeError('Value of `this` is not a HeadersIterator');
		}

		var _INTERNAL = this[INTERNAL];
		const target = _INTERNAL.target,
		      kind = _INTERNAL.kind,
		      index = _INTERNAL.index;

		const values = getHeaders(target, kind);
		const len = values.length;
		if (index >= len) {
			return {
				value: undefined,
				done: true
			};
		}

		this[INTERNAL].index = index + 1;

		return {
			value: values[index],
			done: false
		};
	}
}, Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())));

Object.defineProperty(HeadersIteratorPrototype, Symbol.toStringTag, {
	value: 'HeadersIterator',
	writable: false,
	enumerable: false,
	configurable: true
});

/**
 * Export the Headers object in a form that Node.js can consume.
 *
 * @param   Headers  headers
 * @return  Object
 */
function exportNodeCompatibleHeaders(headers) {
	const obj = Object.assign({ __proto__: null }, headers[MAP]);

	// http.request() only supports string as Host header. This hack makes
	// specifying custom Host header possible.
	const hostHeaderKey = find(headers[MAP], 'Host');
	if (hostHeaderKey !== undefined) {
		obj[hostHeaderKey] = obj[hostHeaderKey][0];
	}

	return obj;
}

/**
 * Create a Headers object from an object of headers, ignoring those that do
 * not conform to HTTP grammar productions.
 *
 * @param   Object  obj  Object of headers
 * @return  Headers
 */
function createHeadersLenient(obj) {
	const headers = new Headers();
	for (const name of Object.keys(obj)) {
		if (invalidTokenRegex.test(name)) {
			continue;
		}
		if (Array.isArray(obj[name])) {
			for (const val of obj[name]) {
				if (invalidHeaderCharRegex.test(val)) {
					continue;
				}
				if (headers[MAP][name] === undefined) {
					headers[MAP][name] = [val];
				} else {
					headers[MAP][name].push(val);
				}
			}
		} else if (!invalidHeaderCharRegex.test(obj[name])) {
			headers[MAP][name] = [obj[name]];
		}
	}
	return headers;
}

const INTERNALS$1 = Symbol('Response internals');

// fix an issue where "STATUS_CODES" aren't a named export for node <10
const STATUS_CODES = http.STATUS_CODES;

/**
 * Response class
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
class Response {
	constructor() {
		let body = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
		let opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

		Body.call(this, body, opts);

		const status = opts.status || 200;
		const headers = new Headers(opts.headers);

		if (body != null && !headers.has('Content-Type')) {
			const contentType = extractContentType(body);
			if (contentType) {
				headers.append('Content-Type', contentType);
			}
		}

		this[INTERNALS$1] = {
			url: opts.url,
			status,
			statusText: opts.statusText || STATUS_CODES[status],
			headers,
			counter: opts.counter
		};
	}

	get url() {
		return this[INTERNALS$1].url || '';
	}

	get status() {
		return this[INTERNALS$1].status;
	}

	/**
  * Convenience property representing if the request ended normally
  */
	get ok() {
		return this[INTERNALS$1].status >= 200 && this[INTERNALS$1].status < 300;
	}

	get redirected() {
		return this[INTERNALS$1].counter > 0;
	}

	get statusText() {
		return this[INTERNALS$1].statusText;
	}

	get headers() {
		return this[INTERNALS$1].headers;
	}

	/**
  * Clone this response
  *
  * @return  Response
  */
	clone() {
		return new Response(clone(this), {
			url: this.url,
			status: this.status,
			statusText: this.statusText,
			headers: this.headers,
			ok: this.ok,
			redirected: this.redirected
		});
	}
}

Body.mixIn(Response.prototype);

Object.defineProperties(Response.prototype, {
	url: { enumerable: true },
	status: { enumerable: true },
	ok: { enumerable: true },
	redirected: { enumerable: true },
	statusText: { enumerable: true },
	headers: { enumerable: true },
	clone: { enumerable: true }
});

Object.defineProperty(Response.prototype, Symbol.toStringTag, {
	value: 'Response',
	writable: false,
	enumerable: false,
	configurable: true
});

const INTERNALS$2 = Symbol('Request internals');

// fix an issue where "format", "parse" aren't a named export for node <10
const parse_url = Url.parse;
const format_url = Url.format;

const streamDestructionSupported = 'destroy' in Stream.Readable.prototype;

/**
 * Check if a value is an instance of Request.
 *
 * @param   Mixed   input
 * @return  Boolean
 */
function isRequest(input) {
	return typeof input === 'object' && typeof input[INTERNALS$2] === 'object';
}

function isAbortSignal(signal) {
	const proto = signal && typeof signal === 'object' && Object.getPrototypeOf(signal);
	return !!(proto && proto.constructor.name === 'AbortSignal');
}

/**
 * Request class
 *
 * @param   Mixed   input  Url or Request instance
 * @param   Object  init   Custom options
 * @return  Void
 */
class Request {
	constructor(input) {
		let init = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

		let parsedURL;

		// normalize input
		if (!isRequest(input)) {
			if (input && input.href) {
				// in order to support Node.js' Url objects; though WHATWG's URL objects
				// will fall into this branch also (since their `toString()` will return
				// `href` property anyway)
				parsedURL = parse_url(input.href);
			} else {
				// coerce input to a string before attempting to parse
				parsedURL = parse_url(`${input}`);
			}
			input = {};
		} else {
			parsedURL = parse_url(input.url);
		}

		let method = init.method || input.method || 'GET';
		method = method.toUpperCase();

		if ((init.body != null || isRequest(input) && input.body !== null) && (method === 'GET' || method === 'HEAD')) {
			throw new TypeError('Request with GET/HEAD method cannot have body');
		}

		let inputBody = init.body != null ? init.body : isRequest(input) && input.body !== null ? clone(input) : null;

		Body.call(this, inputBody, {
			timeout: init.timeout || input.timeout || 0,
			size: init.size || input.size || 0
		});

		const headers = new Headers(init.headers || input.headers || {});

		if (inputBody != null && !headers.has('Content-Type')) {
			const contentType = extractContentType(inputBody);
			if (contentType) {
				headers.append('Content-Type', contentType);
			}
		}

		let signal = isRequest(input) ? input.signal : null;
		if ('signal' in init) signal = init.signal;

		if (signal != null && !isAbortSignal(signal)) {
			throw new TypeError('Expected signal to be an instanceof AbortSignal');
		}

		this[INTERNALS$2] = {
			method,
			redirect: init.redirect || input.redirect || 'follow',
			headers,
			parsedURL,
			signal
		};

		// node-fetch-only options
		this.follow = init.follow !== undefined ? init.follow : input.follow !== undefined ? input.follow : 20;
		this.compress = init.compress !== undefined ? init.compress : input.compress !== undefined ? input.compress : true;
		this.counter = init.counter || input.counter || 0;
		this.agent = init.agent || input.agent;
	}

	get method() {
		return this[INTERNALS$2].method;
	}

	get url() {
		return format_url(this[INTERNALS$2].parsedURL);
	}

	get headers() {
		return this[INTERNALS$2].headers;
	}

	get redirect() {
		return this[INTERNALS$2].redirect;
	}

	get signal() {
		return this[INTERNALS$2].signal;
	}

	/**
  * Clone this request
  *
  * @return  Request
  */
	clone() {
		return new Request(this);
	}
}

Body.mixIn(Request.prototype);

Object.defineProperty(Request.prototype, Symbol.toStringTag, {
	value: 'Request',
	writable: false,
	enumerable: false,
	configurable: true
});

Object.defineProperties(Request.prototype, {
	method: { enumerable: true },
	url: { enumerable: true },
	headers: { enumerable: true },
	redirect: { enumerable: true },
	clone: { enumerable: true },
	signal: { enumerable: true }
});

/**
 * Convert a Request to Node.js http request options.
 *
 * @param   Request  A Request instance
 * @return  Object   The options object to be passed to http.request
 */
function getNodeRequestOptions(request) {
	const parsedURL = request[INTERNALS$2].parsedURL;
	const headers = new Headers(request[INTERNALS$2].headers);

	// fetch step 1.3
	if (!headers.has('Accept')) {
		headers.set('Accept', '*/*');
	}

	// Basic fetch
	if (!parsedURL.protocol || !parsedURL.hostname) {
		throw new TypeError('Only absolute URLs are supported');
	}

	if (!/^https?:$/.test(parsedURL.protocol)) {
		throw new TypeError('Only HTTP(S) protocols are supported');
	}

	if (request.signal && request.body instanceof Stream.Readable && !streamDestructionSupported) {
		throw new Error('Cancellation of streamed requests with AbortSignal is not supported in node < 8');
	}

	// HTTP-network-or-cache fetch steps 2.4-2.7
	let contentLengthValue = null;
	if (request.body == null && /^(POST|PUT)$/i.test(request.method)) {
		contentLengthValue = '0';
	}
	if (request.body != null) {
		const totalBytes = getTotalBytes(request);
		if (typeof totalBytes === 'number') {
			contentLengthValue = String(totalBytes);
		}
	}
	if (contentLengthValue) {
		headers.set('Content-Length', contentLengthValue);
	}

	// HTTP-network-or-cache fetch step 2.11
	if (!headers.has('User-Agent')) {
		headers.set('User-Agent', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)');
	}

	// HTTP-network-or-cache fetch step 2.15
	if (request.compress && !headers.has('Accept-Encoding')) {
		headers.set('Accept-Encoding', 'gzip,deflate');
	}

	let agent = request.agent;
	if (typeof agent === 'function') {
		agent = agent(parsedURL);
	}

	if (!headers.has('Connection') && !agent) {
		headers.set('Connection', 'close');
	}

	// HTTP-network fetch step 4.2
	// chunked encoding is handled by Node.js

	return Object.assign({}, parsedURL, {
		method: request.method,
		headers: exportNodeCompatibleHeaders(headers),
		agent
	});
}

/**
 * abort-error.js
 *
 * AbortError interface for cancelled requests
 */

/**
 * Create AbortError instance
 *
 * @param   String      message      Error message for human
 * @return  AbortError
 */
function AbortError(message) {
  Error.call(this, message);

  this.type = 'aborted';
  this.message = message;

  // hide custom error implementation details from end-users
  Error.captureStackTrace(this, this.constructor);
}

AbortError.prototype = Object.create(Error.prototype);
AbortError.prototype.constructor = AbortError;
AbortError.prototype.name = 'AbortError';

// fix an issue where "PassThrough", "resolve" aren't a named export for node <10
const PassThrough$1 = Stream.PassThrough;
const resolve_url = Url.resolve;

/**
 * Fetch function
 *
 * @param   Mixed    url   Absolute url or Request instance
 * @param   Object   opts  Fetch options
 * @return  Promise
 */
function fetch(url, opts) {

	// allow custom promise
	if (!fetch.Promise) {
		throw new Error('native promise missing, set fetch.Promise to your favorite alternative');
	}

	Body.Promise = fetch.Promise;

	// wrap http.request into fetch
	return new fetch.Promise(function (resolve, reject) {
		// build request object
		const request = new Request(url, opts);
		const options = getNodeRequestOptions(request);

		const send = (options.protocol === 'https:' ? https : http).request;
		const signal = request.signal;

		let response = null;

		const abort = function abort() {
			let error = new AbortError('The user aborted a request.');
			reject(error);
			if (request.body && request.body instanceof Stream.Readable) {
				request.body.destroy(error);
			}
			if (!response || !response.body) return;
			response.body.emit('error', error);
		};

		if (signal && signal.aborted) {
			abort();
			return;
		}

		const abortAndFinalize = function abortAndFinalize() {
			abort();
			finalize();
		};

		// send request
		const req = send(options);
		let reqTimeout;

		if (signal) {
			signal.addEventListener('abort', abortAndFinalize);
		}

		function finalize() {
			req.abort();
			if (signal) signal.removeEventListener('abort', abortAndFinalize);
			clearTimeout(reqTimeout);
		}

		if (request.timeout) {
			req.once('socket', function (socket) {
				reqTimeout = setTimeout(function () {
					reject(new FetchError(`network timeout at: ${request.url}`, 'request-timeout'));
					finalize();
				}, request.timeout);
			});
		}

		req.on('error', function (err) {
			reject(new FetchError(`request to ${request.url} failed, reason: ${err.message}`, 'system', err));
			finalize();
		});

		req.on('response', function (res) {
			clearTimeout(reqTimeout);

			const headers = createHeadersLenient(res.headers);

			// HTTP fetch step 5
			if (fetch.isRedirect(res.statusCode)) {
				// HTTP fetch step 5.2
				const location = headers.get('Location');

				// HTTP fetch step 5.3
				const locationURL = location === null ? null : resolve_url(request.url, location);

				// HTTP fetch step 5.5
				switch (request.redirect) {
					case 'error':
						reject(new FetchError(`uri requested responds with a redirect, redirect mode is set to error: ${request.url}`, 'no-redirect'));
						finalize();
						return;
					case 'manual':
						// node-fetch-specific step: make manual redirect a bit easier to use by setting the Location header value to the resolved URL.
						if (locationURL !== null) {
							// handle corrupted header
							try {
								headers.set('Location', locationURL);
							} catch (err) {
								// istanbul ignore next: nodejs server prevent invalid response headers, we can't test this through normal request
								reject(err);
							}
						}
						break;
					case 'follow':
						// HTTP-redirect fetch step 2
						if (locationURL === null) {
							break;
						}

						// HTTP-redirect fetch step 5
						if (request.counter >= request.follow) {
							reject(new FetchError(`maximum redirect reached at: ${request.url}`, 'max-redirect'));
							finalize();
							return;
						}

						// HTTP-redirect fetch step 6 (counter increment)
						// Create a new Request object.
						const requestOpts = {
							headers: new Headers(request.headers),
							follow: request.follow,
							counter: request.counter + 1,
							agent: request.agent,
							compress: request.compress,
							method: request.method,
							body: request.body,
							signal: request.signal,
							timeout: request.timeout,
							size: request.size
						};

						// HTTP-redirect fetch step 9
						if (res.statusCode !== 303 && request.body && getTotalBytes(request) === null) {
							reject(new FetchError('Cannot follow redirect with body being a readable stream', 'unsupported-redirect'));
							finalize();
							return;
						}

						// HTTP-redirect fetch step 11
						if (res.statusCode === 303 || (res.statusCode === 301 || res.statusCode === 302) && request.method === 'POST') {
							requestOpts.method = 'GET';
							requestOpts.body = undefined;
							requestOpts.headers.delete('content-length');
						}

						// HTTP-redirect fetch step 15
						resolve(fetch(new Request(locationURL, requestOpts)));
						finalize();
						return;
				}
			}

			// prepare response
			res.once('end', function () {
				if (signal) signal.removeEventListener('abort', abortAndFinalize);
			});
			let body = res.pipe(new PassThrough$1());

			const response_options = {
				url: request.url,
				status: res.statusCode,
				statusText: res.statusMessage,
				headers: headers,
				size: request.size,
				timeout: request.timeout,
				counter: request.counter
			};

			// HTTP-network fetch step 12.1.1.3
			const codings = headers.get('Content-Encoding');

			// HTTP-network fetch step 12.1.1.4: handle content codings

			// in following scenarios we ignore compression support
			// 1. compression support is disabled
			// 2. HEAD request
			// 3. no Content-Encoding header
			// 4. no content response (204)
			// 5. content not modified response (304)
			if (!request.compress || request.method === 'HEAD' || codings === null || res.statusCode === 204 || res.statusCode === 304) {
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// For Node v6+
			// Be less strict when decoding compressed responses, since sometimes
			// servers send slightly invalid responses that are still accepted
			// by common browsers.
			// Always using Z_SYNC_FLUSH is what cURL does.
			const zlibOptions = {
				flush: zlib.Z_SYNC_FLUSH,
				finishFlush: zlib.Z_SYNC_FLUSH
			};

			// for gzip
			if (codings == 'gzip' || codings == 'x-gzip') {
				body = body.pipe(zlib.createGunzip(zlibOptions));
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// for deflate
			if (codings == 'deflate' || codings == 'x-deflate') {
				// handle the infamous raw deflate response from old servers
				// a hack for old IIS and Apache servers
				const raw = res.pipe(new PassThrough$1());
				raw.once('data', function (chunk) {
					// see http://stackoverflow.com/questions/37519828
					if ((chunk[0] & 0x0F) === 0x08) {
						body = body.pipe(zlib.createInflate());
					} else {
						body = body.pipe(zlib.createInflateRaw());
					}
					response = new Response(body, response_options);
					resolve(response);
				});
				return;
			}

			// for br
			if (codings == 'br' && typeof zlib.createBrotliDecompress === 'function') {
				body = body.pipe(zlib.createBrotliDecompress());
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// otherwise, use response as-is
			response = new Response(body, response_options);
			resolve(response);
		});

		writeToStream(req, request);
	});
}
/**
 * Redirect code matching
 *
 * @param   Number   code  Status code
 * @return  Boolean
 */
fetch.isRedirect = function (code) {
	return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
};

// expose Promise
fetch.Promise = global.Promise;

module.exports = exports = fetch;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = exports;
exports.Headers = Headers;
exports.Request = Request;
exports.Response = Response;
exports.FetchError = FetchError;


/***/ }),

/***/ 500:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
// TODO: Update https://github.com/sindresorhus/get-stream
const getBuffer = async (stream) => {
    const chunks = [];
    let length = 0;
    for await (const chunk of stream) {
        chunks.push(chunk);
        length += Buffer.byteLength(chunk);
    }
    if (Buffer.isBuffer(chunks[0])) {
        return Buffer.concat(chunks, length);
    }
    return Buffer.from(chunks.join(''));
};
exports.default = getBuffer;


/***/ }),

/***/ 531:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const EventEmitter = __webpack_require__(614);
const JSONB = __webpack_require__(820);

const loadStore = opts => {
	const adapters = {
		redis: '@keyv/redis',
		mongodb: '@keyv/mongo',
		mongo: '@keyv/mongo',
		sqlite: '@keyv/sqlite',
		postgresql: '@keyv/postgres',
		postgres: '@keyv/postgres',
		mysql: '@keyv/mysql'
	};
	if (opts.adapter || opts.uri) {
		const adapter = opts.adapter || /^[^:]*/.exec(opts.uri)[0];
		return new (require(adapters[adapter]))(opts);
	}

	return new Map();
};

class Keyv extends EventEmitter {
	constructor(uri, opts) {
		super();
		this.opts = Object.assign(
			{
				namespace: 'keyv',
				serialize: JSONB.stringify,
				deserialize: JSONB.parse
			},
			(typeof uri === 'string') ? { uri } : uri,
			opts
		);

		if (!this.opts.store) {
			const adapterOpts = Object.assign({}, this.opts);
			this.opts.store = loadStore(adapterOpts);
		}

		if (typeof this.opts.store.on === 'function') {
			this.opts.store.on('error', err => this.emit('error', err));
		}

		this.opts.store.namespace = this.opts.namespace;
	}

	_getKeyPrefix(key) {
		return `${this.opts.namespace}:${key}`;
	}

	get(key, opts) {
		const keyPrefixed = this._getKeyPrefix(key);
		const { store } = this.opts;
		return Promise.resolve()
			.then(() => store.get(keyPrefixed))
			.then(data => {
				return (typeof data === 'string') ? this.opts.deserialize(data) : data;
			})
			.then(data => {
				if (data === undefined) {
					return undefined;
				}

				if (typeof data.expires === 'number' && Date.now() > data.expires) {
					this.delete(key);
					return undefined;
				}

				return (opts && opts.raw) ? data : data.value;
			});
	}

	set(key, value, ttl) {
		const keyPrefixed = this._getKeyPrefix(key);
		if (typeof ttl === 'undefined') {
			ttl = this.opts.ttl;
		}

		if (ttl === 0) {
			ttl = undefined;
		}

		const { store } = this.opts;

		return Promise.resolve()
			.then(() => {
				const expires = (typeof ttl === 'number') ? (Date.now() + ttl) : null;
				value = { value, expires };
				return this.opts.serialize(value);
			})
			.then(value => store.set(keyPrefixed, value, ttl))
			.then(() => true);
	}

	delete(key) {
		const keyPrefixed = this._getKeyPrefix(key);
		const { store } = this.opts;
		return Promise.resolve()
			.then(() => store.delete(keyPrefixed));
	}

	clear() {
		const { store } = this.opts;
		return Promise.resolve()
			.then(() => store.clear());
	}
}

module.exports = Keyv;


/***/ }),

/***/ 537:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var deprecation = __webpack_require__(932);
var once = _interopDefault(__webpack_require__(223));

const logOnce = once(deprecation => console.warn(deprecation));
/**
 * Error with extra properties to help with debugging
 */

class RequestError extends Error {
  constructor(message, statusCode, options) {
    super(message); // Maintains proper stack trace (only available on V8)

    /* istanbul ignore next */

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = "HttpError";
    this.status = statusCode;
    Object.defineProperty(this, "code", {
      get() {
        logOnce(new deprecation.Deprecation("[@octokit/request-error] `error.code` is deprecated, use `error.status`."));
        return statusCode;
      }

    });
    this.headers = options.headers || {}; // redact request credentials without mutating original request options

    const requestCopy = Object.assign({}, options.request);

    if (options.request.headers.authorization) {
      requestCopy.headers = Object.assign({}, options.request.headers, {
        authorization: options.request.headers.authorization.replace(/ .*$/, " [REDACTED]")
      });
    }

    requestCopy.url = requestCopy.url // client_id & client_secret can be passed as URL query parameters to increase rate limit
    // see https://developer.github.com/v3/#increasing-the-unauthenticated-rate-limit-for-oauth-applications
    .replace(/\bclient_secret=\w+/g, "client_secret=[REDACTED]") // OAuth tokens can be passed as URL query parameters, although it is not recommended
    // see https://developer.github.com/v3/#oauth2-token-sent-in-a-header
    .replace(/\baccess_token=\w+/g, "access_token=[REDACTED]");
    this.request = requestCopy;
  }

}

exports.RequestError = RequestError;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 549:
/***/ (function(module) {

module.exports = addHook

function addHook (state, kind, name, hook) {
  var orig = hook
  if (!state.registry[name]) {
    state.registry[name] = []
  }

  if (kind === 'before') {
    hook = function (method, options) {
      return Promise.resolve()
        .then(orig.bind(null, options))
        .then(method.bind(null, options))
    }
  }

  if (kind === 'after') {
    hook = function (method, options) {
      var result
      return Promise.resolve()
        .then(method.bind(null, options))
        .then(function (result_) {
          result = result_
          return orig(result, options)
        })
        .then(function () {
          return result
        })
    }
  }

  if (kind === 'error') {
    hook = function (method, options) {
      return Promise.resolve()
        .then(method.bind(null, options))
        .catch(function (error) {
          return orig(error, options)
        })
    }
  }

  state.registry[name].push({
    hook: hook,
    orig: orig
  })
}


/***/ }),

/***/ 554:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";
// This file is generated by `build.js`


/* Load `trigram-utils`. */
var utilities = __webpack_require__(683)

/* Load `expressions` (regular expressions matching
 * scripts). */
var expressions = __webpack_require__(950)

/* Load `data` (trigram information per language,
 * per script). */
var data = __webpack_require__(73)

/* Expose `detectAll` on `detect`. */
detect.all = detectAll

/* Expose `detect`. */
module.exports = detect

/* Maximum sample length. */
var MAX_LENGTH = 2048

/* Minimum sample length. */
var MIN_LENGTH = 10

/* The maximum distance to add when a given trigram does
 * not exist in a trigram dictionary. */
var MAX_DIFFERENCE = 300

/* Construct trigram dictionaries. */
;(function() {
  var languages
  var name
  var trigrams
  var model
  var script
  var weight

  for (script in data) {
    languages = data[script]

    for (name in languages) {
      model = languages[name].split('|')

      weight = model.length

      trigrams = {}

      while (weight--) {
        trigrams[model[weight]] = weight
      }

      languages[name] = trigrams
    }
  }
})()

/**
 * Get the most probable language for the given value.
 *
 * @param {string} value - The value to test.
 * @param {Object} options - Configuration.
 * @return {string} The most probable language.
 */
function detect(value, options) {
  return detectAll(value, options)[0][0]
}

/**
 * Get a list of probable languages the given value is
 * written in.
 *
 * @param {string} value - The value to test.
 * @param {Object} options - Configuration.
 * @return {Array.<Array.<string, number>>} An array
 *   containing language--distance tuples.
 */
function detectAll(value, options) {
  var settings = options || {}
  var minLength = MIN_LENGTH
  var only = [].concat(settings.whitelist || [], settings.only || [])
  var ignore = [].concat(settings.blacklist || [], settings.ignore || [])
  var script

  if (settings.minLength !== null && settings.minLength !== undefined) {
    minLength = settings.minLength
  }

  if (!value || value.length < minLength) {
    return und()
  }

  value = value.slice(0, MAX_LENGTH)

  /* Get the script which characters occur the most
   * in `value`. */
  script = getTopScript(value, expressions)

  /* One languages exists for the most-used script. */
  if (!(script[0] in data)) {
    /* If no matches occured, such as a digit only string,
     * or because the language is ignored, exit with `und`. */
    if (script[1] === 0 || !allow(script[0], only, ignore)) {
      return und()
    }

    return singleLanguageTuples(script[0])
  }

  /* Get all distances for a given script, and
   * normalize the distance values. */
  return normalize(
    value,
    getDistances(utilities.asTuples(value), data[script[0]], only, ignore)
  )
}

/**
 * Normalize the difference for each tuple in
 * `distances`.
 *
 * @param {string} value - Value to normalize.
 * @param {Array.<Array.<string, number>>} distances
 *   - List of distances.
 * @return {Array.<Array.<string, number>>} - Normalized
 *   distances.
 */
function normalize(value, distances) {
  var min = distances[0][1]
  var max = value.length * MAX_DIFFERENCE - min
  var index = -1
  var length = distances.length

  while (++index < length) {
    distances[index][1] = 1 - (distances[index][1] - min) / max || 0
  }

  return distances
}

/**
 * From `scripts`, get the most occurring expression for
 * `value`.
 *
 * @param {string} value - Value to check.
 * @param {Object.<RegExp>} scripts - Top-Scripts.
 * @return {Array} Top script and its
 *   occurrence percentage.
 */
function getTopScript(value, scripts) {
  var topCount = -1
  var topScript
  var script
  var count

  for (script in scripts) {
    count = getOccurrence(value, scripts[script])

    if (count > topCount) {
      topCount = count
      topScript = script
    }
  }

  return [topScript, topCount]
}

/**
 * Get the occurrence ratio of `expression` for `value`.
 *
 * @param {string} value - Value to check.
 * @param {RegExp} expression - Code-point expression.
 * @return {number} Float between 0 and 1.
 */
function getOccurrence(value, expression) {
  var count = value.match(expression)

  return (count ? count.length : 0) / value.length || 0
}

/**
 * Get the distance between an array of trigram--count
 * tuples, and multiple trigram dictionaries.
 *
 * @param {Array.<Array.<string, number>>} trigrams - An
 *   array containing trigram--count tuples.
 * @param {Object.<Object>} languages - multiple
 *   trigrams to test against.
 * @param {Array.<string>} only - Allowed languages; if
 *   non-empty, only included languages are kept.
 * @param {Array.<string>} ignore - Disallowed languages;
 *   included languages are ignored.
 * @return {Array.<Array.<string, number>>} An array
 *   containing language--distance tuples.
 */
function getDistances(trigrams, languages, only, ignore) {
  var distances = []
  var language

  languages = filterLanguages(languages, only, ignore)

  for (language in languages) {
    distances.push([language, getDistance(trigrams, languages[language])])
  }

  return distances.length === 0 ? und() : distances.sort(sort)
}

/**
 * Get the distance between an array of trigram--count
 * tuples, and a language dictionary.
 *
 * @param {Array.<Array.<string, number>>} trigrams - An
 *   array containing trigram--count tuples.
 * @param {Object.<number>} model - Object
 *   containing weighted trigrams.
 * @return {number} - The distance between the two.
 */
function getDistance(trigrams, model) {
  var distance = 0
  var index = -1
  var length = trigrams.length
  var trigram
  var difference

  while (++index < length) {
    trigram = trigrams[index]

    if (trigram[0] in model) {
      difference = trigram[1] - model[trigram[0]] - 1

      if (difference < 0) {
        difference = -difference
      }
    } else {
      difference = MAX_DIFFERENCE
    }

    distance += difference
  }

  return distance
}

/**
 * Filter `languages` by removing languages in
 * `ignore`, or including languages in `only`.
 *
 * @param {Object.<Object>} languages - Languages
 *   to filter
 * @param {Array.<string>} only - Allowed languages; if
 *   non-empty, only included languages are kept.
 * @param {Array.<string>} ignore - Disallowed languages;
 *   included languages are ignored.
 * @return {Object.<Object>} - Filtered array of
 *   languages.
 */
function filterLanguages(languages, only, ignore) {
  var filteredLanguages
  var language

  if (only.length === 0 && ignore.length === 0) {
    return languages
  }

  filteredLanguages = {}

  for (language in languages) {
    if (allow(language, only, ignore)) {
      filteredLanguages[language] = languages[language]
    }
  }

  return filteredLanguages
}

/**
 * Check if `language` can match according to settings.
 *
 * @param {string} language - Languages
 *   to filter
 * @param {Array.<string>} only - Allowed languages; if
 *   non-empty, only included languages are kept.
 * @param {Array.<string>} ignore - Disallowed languages;
 *   included languages are ignored.
 * @return {boolean} - Whether `language` can match
 */
function allow(language, only, ignore) {
  if (only.length === 0 && ignore.length === 0) {
    return true
  }

  return (
    (only.length === 0 || only.indexOf(language) !== -1) &&
    ignore.indexOf(language) === -1
  )
}

/* Create a single `und` tuple. */
function und() {
  return singleLanguageTuples('und')
}

/* Create a single tuple as a list of tuples from a given
 * language code. */
function singleLanguageTuples(language) {
  return [[language, 1]]
}

/* Deep regular sort on the number at `1` in both objects. */
function sort(a, b) {
  return a[1] - b[1]
}


/***/ }),

/***/ 558:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

/*!
 * is-plain-object <https://github.com/jonschlinkert/is-plain-object>
 *
 * Copyright (c) 2014-2017, Jon Schlinkert.
 * Released under the MIT License.
 */

function isObject(o) {
  return Object.prototype.toString.call(o) === '[object Object]';
}

function isPlainObject(o) {
  var ctor,prot;

  if (isObject(o) === false) return false;

  // If has modified constructor
  ctor = o.constructor;
  if (ctor === undefined) return true;

  // If has modified prototype
  prot = ctor.prototype;
  if (isObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
}

exports.isPlainObject = isPlainObject;


/***/ }),

/***/ 564:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __webpack_require__(747);
const util_1 = __webpack_require__(669);
const is_1 = __webpack_require__(678);
const is_form_data_1 = __webpack_require__(813);
const statAsync = util_1.promisify(fs_1.stat);
exports.default = async (body, headers) => {
    if (headers && 'content-length' in headers) {
        return Number(headers['content-length']);
    }
    if (!body) {
        return 0;
    }
    if (is_1.default.string(body)) {
        return Buffer.byteLength(body);
    }
    if (is_1.default.buffer(body)) {
        return body.length;
    }
    if (is_form_data_1.default(body)) {
        return util_1.promisify(body.getLength.bind(body))();
    }
    if (body instanceof fs_1.ReadStream) {
        const { size } = await statAsync(body.path);
        if (size === 0) {
            return undefined;
        }
        return size;
    }
    return undefined;
};


/***/ }),

/***/ 565:
/***/ (function(module) {

module.exports = require("http2");

/***/ }),

/***/ 575:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const {Readable} = __webpack_require__(413);

class IncomingMessage extends Readable {
	constructor(socket, highWaterMark) {
		super({
			highWaterMark,
			autoDestroy: false
		});

		this.statusCode = null;
		this.statusMessage = '';
		this.httpVersion = '2.0';
		this.httpVersionMajor = 2;
		this.httpVersionMinor = 0;
		this.headers = {};
		this.trailers = {};
		this.req = null;

		this.aborted = false;
		this.complete = false;
		this.upgrade = null;

		this.rawHeaders = [];
		this.rawTrailers = [];

		this.socket = socket;
		this.connection = socket;

		this._dumped = false;
	}

	_destroy(error) {
		this.req._request.destroy(error);
	}

	setTimeout(ms, callback) {
		this.req.setTimeout(ms, callback);
		return this;
	}

	_dump() {
		if (!this._dumped) {
			this._dumped = true;

			this.removeAllListeners('data');
			this.resume();
		}
	}

	_read() {
		if (this.req) {
			this.req._request.resume();
		}
	}
}

module.exports = IncomingMessage;


/***/ }),

/***/ 593:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
// When attaching listeners, it's very easy to forget about them.
// Especially if you do error handling and set timeouts.
// So instead of checking if it's proper to throw an error on every timeout ever,
// use this simple tool which will remove all listeners you have attached.
exports.default = () => {
    const handlers = [];
    return {
        once(origin, event, fn) {
            origin.once(event, fn);
            handlers.push({ origin, event, fn });
        },
        unhandleAll() {
            for (const handler of handlers) {
                const { origin, event, fn } = handler;
                origin.removeListener(event, fn);
            }
            handlers.length = 0;
        }
    };
};


/***/ }),

/***/ 597:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelError = exports.ParseError = void 0;
const core_1 = __webpack_require__(94);
/**
An error to be thrown when server response code is 2xx, and parsing body fails.
Includes a `response` property.
*/
class ParseError extends core_1.RequestError {
    constructor(error, response) {
        const { options } = response.request;
        super(`${error.message} in "${options.url.toString()}"`, error, response.request);
        this.name = 'ParseError';
    }
}
exports.ParseError = ParseError;
/**
An error to be thrown when the request is aborted with `.cancel()`.
*/
class CancelError extends core_1.RequestError {
    constructor(request) {
        super('Promise was canceled', {}, request);
        this.name = 'CancelError';
    }
    get isCanceled() {
        return true;
    }
}
exports.CancelError = CancelError;
__exportStar(__webpack_require__(94), exports);


/***/ }),

/***/ 605:
/***/ (function(module) {

module.exports = require("http");

/***/ }),

/***/ 610:
/***/ (function(module) {

"use strict";


// We define these manually to ensure they're always copied
// even if they would move up the prototype chain
// https://nodejs.org/api/http.html#http_class_http_incomingmessage
const knownProps = [
	'destroy',
	'setTimeout',
	'socket',
	'headers',
	'trailers',
	'rawHeaders',
	'statusCode',
	'httpVersion',
	'httpVersionMinor',
	'httpVersionMajor',
	'rawTrailers',
	'statusMessage'
];

module.exports = (fromStream, toStream) => {
	const fromProps = new Set(Object.keys(fromStream).concat(knownProps));

	for (const prop of fromProps) {
		// Don't overwrite existing properties
		if (prop in toStream) {
			continue;
		}

		toStream[prop] = typeof fromStream[prop] === 'function' ? fromStream[prop].bind(fromStream) : fromStream[prop];
	}
};


/***/ }),

/***/ 613:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });


/***/ }),

/***/ 614:
/***/ (function(module) {

module.exports = require("events");

/***/ }),

/***/ 622:
/***/ (function(module) {

module.exports = require("path");

/***/ }),

/***/ 624:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const tls = __webpack_require__(16);

module.exports = (options = {}) => new Promise((resolve, reject) => {
	const socket = tls.connect(options, () => {
		if (options.resolveSocket) {
			socket.off('error', reject);
			resolve({alpnProtocol: socket.alpnProtocol, socket});
		} else {
			socket.destroy();
			resolve({alpnProtocol: socket.alpnProtocol});
		}
	});

	socket.on('error', reject);
});


/***/ }),

/***/ 631:
/***/ (function(module) {

module.exports = require("net");

/***/ }),

/***/ 632:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const http2 = __webpack_require__(565);
const {Writable} = __webpack_require__(413);
const {Agent, globalAgent} = __webpack_require__(898);
const IncomingMessage = __webpack_require__(575);
const urlToOptions = __webpack_require__(686);
const proxyEvents = __webpack_require__(818);
const isRequestPseudoHeader = __webpack_require__(199);
const {
	ERR_INVALID_ARG_TYPE,
	ERR_INVALID_PROTOCOL,
	ERR_HTTP_HEADERS_SENT,
	ERR_INVALID_HTTP_TOKEN,
	ERR_HTTP_INVALID_HEADER_VALUE,
	ERR_INVALID_CHAR
} = __webpack_require__(323);

const {
	HTTP2_HEADER_STATUS,
	HTTP2_HEADER_METHOD,
	HTTP2_HEADER_PATH,
	HTTP2_METHOD_CONNECT
} = http2.constants;

const kHeaders = Symbol('headers');
const kOrigin = Symbol('origin');
const kSession = Symbol('session');
const kOptions = Symbol('options');
const kFlushedHeaders = Symbol('flushedHeaders');
const kJobs = Symbol('jobs');

const isValidHttpToken = /^[\^`\-\w!#$%&*+.|~]+$/;
const isInvalidHeaderValue = /[^\t\u0020-\u007E\u0080-\u00FF]/;

class ClientRequest extends Writable {
	constructor(input, options, callback) {
		super({
			autoDestroy: false
		});

		const hasInput = typeof input === 'string' || input instanceof URL;
		if (hasInput) {
			input = urlToOptions(input instanceof URL ? input : new URL(input));
		}

		if (typeof options === 'function' || options === undefined) {
			// (options, callback)
			callback = options;
			options = hasInput ? input : {...input};
		} else {
			// (input, options, callback)
			options = {...input, ...options};
		}

		if (options.h2session) {
			this[kSession] = options.h2session;
		} else if (options.agent === false) {
			this.agent = new Agent({maxFreeSessions: 0});
		} else if (typeof options.agent === 'undefined' || options.agent === null) {
			if (typeof options.createConnection === 'function') {
				// This is a workaround - we don't have to create the session on our own.
				this.agent = new Agent({maxFreeSessions: 0});
				this.agent.createConnection = options.createConnection;
			} else {
				this.agent = globalAgent;
			}
		} else if (typeof options.agent.request === 'function') {
			this.agent = options.agent;
		} else {
			throw new ERR_INVALID_ARG_TYPE('options.agent', ['Agent-like Object', 'undefined', 'false'], options.agent);
		}

		if (options.protocol && options.protocol !== 'https:') {
			throw new ERR_INVALID_PROTOCOL(options.protocol, 'https:');
		}

		const port = options.port || options.defaultPort || (this.agent && this.agent.defaultPort) || 443;
		const host = options.hostname || options.host || 'localhost';

		// Don't enforce the origin via options. It may be changed in an Agent.
		delete options.hostname;
		delete options.host;
		delete options.port;

		const {timeout} = options;
		options.timeout = undefined;

		this[kHeaders] = Object.create(null);
		this[kJobs] = [];

		this.socket = null;
		this.connection = null;

		this.method = options.method || 'GET';
		this.path = options.path;

		this.res = null;
		this.aborted = false;
		this.reusedSocket = false;

		if (options.headers) {
			for (const [header, value] of Object.entries(options.headers)) {
				this.setHeader(header, value);
			}
		}

		if (options.auth && !('authorization' in this[kHeaders])) {
			this[kHeaders].authorization = 'Basic ' + Buffer.from(options.auth).toString('base64');
		}

		options.session = options.tlsSession;
		options.path = options.socketPath;

		this[kOptions] = options;

		// Clients that generate HTTP/2 requests directly SHOULD use the :authority pseudo-header field instead of the Host header field.
		if (port === 443) {
			this[kOrigin] = `https://${host}`;

			if (!(':authority' in this[kHeaders])) {
				this[kHeaders][':authority'] = host;
			}
		} else {
			this[kOrigin] = `https://${host}:${port}`;

			if (!(':authority' in this[kHeaders])) {
				this[kHeaders][':authority'] = `${host}:${port}`;
			}
		}

		if (timeout) {
			this.setTimeout(timeout);
		}

		if (callback) {
			this.once('response', callback);
		}

		this[kFlushedHeaders] = false;
	}

	get method() {
		return this[kHeaders][HTTP2_HEADER_METHOD];
	}

	set method(value) {
		if (value) {
			this[kHeaders][HTTP2_HEADER_METHOD] = value.toUpperCase();
		}
	}

	get path() {
		return this[kHeaders][HTTP2_HEADER_PATH];
	}

	set path(value) {
		if (value) {
			this[kHeaders][HTTP2_HEADER_PATH] = value;
		}
	}

	get _mustNotHaveABody() {
		return this.method === 'GET' || this.method === 'HEAD' || this.method === 'DELETE';
	}

	_write(chunk, encoding, callback) {
		// https://github.com/nodejs/node/blob/654df09ae0c5e17d1b52a900a545f0664d8c7627/lib/internal/http2/util.js#L148-L156
		if (this._mustNotHaveABody) {
			callback(new Error('The GET, HEAD and DELETE methods must NOT have a body'));
			/* istanbul ignore next: Node.js 12 throws directly */
			return;
		}

		this.flushHeaders();

		const callWrite = () => this._request.write(chunk, encoding, callback);
		if (this._request) {
			callWrite();
		} else {
			this[kJobs].push(callWrite);
		}
	}

	_final(callback) {
		if (this.destroyed) {
			return;
		}

		this.flushHeaders();

		const callEnd = () => {
			// For GET, HEAD and DELETE
			if (this._mustNotHaveABody) {
				callback();
				return;
			}

			this._request.end(callback);
		};

		if (this._request) {
			callEnd();
		} else {
			this[kJobs].push(callEnd);
		}
	}

	abort() {
		if (this.res && this.res.complete) {
			return;
		}

		if (!this.aborted) {
			process.nextTick(() => this.emit('abort'));
		}

		this.aborted = true;

		this.destroy();
	}

	_destroy(error, callback) {
		if (this.res) {
			this.res._dump();
		}

		if (this._request) {
			this._request.destroy();
		}

		callback(error);
	}

	async flushHeaders() {
		if (this[kFlushedHeaders] || this.destroyed) {
			return;
		}

		this[kFlushedHeaders] = true;

		const isConnectMethod = this.method === HTTP2_METHOD_CONNECT;

		// The real magic is here
		const onStream = stream => {
			this._request = stream;

			if (this.destroyed) {
				stream.destroy();
				return;
			}

			// Forwards `timeout`, `continue`, `close` and `error` events to this instance.
			if (!isConnectMethod) {
				proxyEvents(stream, this, ['timeout', 'continue', 'close', 'error']);
			}

			// Wait for the `finish` event. We don't want to emit the `response` event
			// before `request.end()` is called.
			const waitForEnd = fn => {
				return (...args) => {
					if (!this.writable && !this.destroyed) {
						fn(...args);
					} else {
						this.once('finish', () => {
							fn(...args);
						});
					}
				};
			};

			// This event tells we are ready to listen for the data.
			stream.once('response', waitForEnd((headers, flags, rawHeaders) => {
				// If we were to emit raw request stream, it would be as fast as the native approach.
				// Note that wrapping the raw stream in a Proxy instance won't improve the performance (already tested it).
				const response = new IncomingMessage(this.socket, stream.readableHighWaterMark);
				this.res = response;

				response.req = this;
				response.statusCode = headers[HTTP2_HEADER_STATUS];
				response.headers = headers;
				response.rawHeaders = rawHeaders;

				response.once('end', () => {
					if (this.aborted) {
						response.aborted = true;
						response.emit('aborted');
					} else {
						response.complete = true;

						// Has no effect, just be consistent with the Node.js behavior
						response.socket = null;
						response.connection = null;
					}
				});

				if (isConnectMethod) {
					response.upgrade = true;

					// The HTTP1 API says the socket is detached here,
					// but we can't do that so we pass the original HTTP2 request.
					if (this.emit('connect', response, stream, Buffer.alloc(0))) {
						this.emit('close');
					} else {
						// No listeners attached, destroy the original request.
						stream.destroy();
					}
				} else {
					// Forwards data
					stream.on('data', chunk => {
						if (!response._dumped && !response.push(chunk)) {
							stream.pause();
						}
					});

					stream.once('end', () => {
						response.push(null);
					});

					if (!this.emit('response', response)) {
						// No listeners attached, dump the response.
						response._dump();
					}
				}
			}));

			// Emits `information` event
			stream.once('headers', waitForEnd(
				headers => this.emit('information', {statusCode: headers[HTTP2_HEADER_STATUS]})
			));

			stream.once('trailers', waitForEnd((trailers, flags, rawTrailers) => {
				const {res} = this;

				// Assigns trailers to the response object.
				res.trailers = trailers;
				res.rawTrailers = rawTrailers;
			}));

			const {socket} = stream.session;
			this.socket = socket;
			this.connection = socket;

			for (const job of this[kJobs]) {
				job();
			}

			this.emit('socket', this.socket);
		};

		// Makes a HTTP2 request
		if (this[kSession]) {
			try {
				onStream(this[kSession].request(this[kHeaders]));
			} catch (error) {
				this.emit('error', error);
			}
		} else {
			this.reusedSocket = true;

			try {
				onStream(await this.agent.request(this[kOrigin], this[kOptions], this[kHeaders]));
			} catch (error) {
				this.emit('error', error);
			}
		}
	}

	getHeader(name) {
		if (typeof name !== 'string') {
			throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
		}

		return this[kHeaders][name.toLowerCase()];
	}

	get headersSent() {
		return this[kFlushedHeaders];
	}

	removeHeader(name) {
		if (typeof name !== 'string') {
			throw new ERR_INVALID_ARG_TYPE('name', 'string', name);
		}

		if (this.headersSent) {
			throw new ERR_HTTP_HEADERS_SENT('remove');
		}

		delete this[kHeaders][name.toLowerCase()];
	}

	setHeader(name, value) {
		if (this.headersSent) {
			throw new ERR_HTTP_HEADERS_SENT('set');
		}

		if (typeof name !== 'string' || (!isValidHttpToken.test(name) && !isRequestPseudoHeader(name))) {
			throw new ERR_INVALID_HTTP_TOKEN('Header name', name);
		}

		if (typeof value === 'undefined') {
			throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
		}

		if (isInvalidHeaderValue.test(value)) {
			throw new ERR_INVALID_CHAR('header content', name);
		}

		this[kHeaders][name.toLowerCase()] = value;
	}

	setNoDelay() {
		// HTTP2 sockets cannot be malformed, do nothing.
	}

	setSocketKeepAlive() {
		// HTTP2 sockets cannot be malformed, do nothing.
	}

	setTimeout(ms, callback) {
		const applyTimeout = () => this._request.setTimeout(ms, callback);

		if (this._request) {
			applyTimeout();
		} else {
			this[kJobs].push(applyTimeout);
		}

		return this;
	}

	get maxHeadersCount() {
		if (!this.destroyed && this._request) {
			return this._request.session.localSettings.maxHeaderListSize;
		}

		return undefined;
	}

	set maxHeadersCount(_value) {
		// Updating HTTP2 settings would affect all requests, do nothing.
	}
}

module.exports = ClientRequest;


/***/ }),

/***/ 645:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const http2 = __webpack_require__(565);
const agent = __webpack_require__(898);
const ClientRequest = __webpack_require__(632);
const IncomingMessage = __webpack_require__(575);
const auto = __webpack_require__(167);

const request = (url, options, callback) => {
	return new ClientRequest(url, options, callback);
};

const get = (url, options, callback) => {
	// eslint-disable-next-line unicorn/prevent-abbreviations
	const req = new ClientRequest(url, options, callback);
	req.end();

	return req;
};

module.exports = {
	...http2,
	ClientRequest,
	IncomingMessage,
	...agent,
	request,
	get,
	auto
};


/***/ }),

/***/ 662:
/***/ (function(module) {

"use strict";

module.exports = object => {
	const result = {};

	for (const [key, value] of Object.entries(object)) {
		result[key.toLowerCase()] = value;
	}

	return result;
};


/***/ }),

/***/ 668:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

var request = __webpack_require__(234);
var universalUserAgent = __webpack_require__(429);

const VERSION = "4.5.7";

class GraphqlError extends Error {
  constructor(request, response) {
    const message = response.data.errors[0].message;
    super(message);
    Object.assign(this, response.data);
    Object.assign(this, {
      headers: response.headers
    });
    this.name = "GraphqlError";
    this.request = request; // Maintains proper stack trace (only available on V8)

    /* istanbul ignore next */

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

}

const NON_VARIABLE_OPTIONS = ["method", "baseUrl", "url", "headers", "request", "query", "mediaType"];
const GHES_V3_SUFFIX_REGEX = /\/api\/v3\/?$/;
function graphql(request, query, options) {
  if (typeof query === "string" && options && "query" in options) {
    return Promise.reject(new Error(`[@octokit/graphql] "query" cannot be used as variable name`));
  }

  const parsedOptions = typeof query === "string" ? Object.assign({
    query
  }, options) : query;
  const requestOptions = Object.keys(parsedOptions).reduce((result, key) => {
    if (NON_VARIABLE_OPTIONS.includes(key)) {
      result[key] = parsedOptions[key];
      return result;
    }

    if (!result.variables) {
      result.variables = {};
    }

    result.variables[key] = parsedOptions[key];
    return result;
  }, {}); // workaround for GitHub Enterprise baseUrl set with /api/v3 suffix
  // https://github.com/octokit/auth-app.js/issues/111#issuecomment-657610451

  const baseUrl = parsedOptions.baseUrl || request.endpoint.DEFAULTS.baseUrl;

  if (GHES_V3_SUFFIX_REGEX.test(baseUrl)) {
    requestOptions.url = baseUrl.replace(GHES_V3_SUFFIX_REGEX, "/api/graphql");
  }

  return request(requestOptions).then(response => {
    if (response.data.errors) {
      const headers = {};

      for (const key of Object.keys(response.headers)) {
        headers[key] = response.headers[key];
      }

      throw new GraphqlError(requestOptions, {
        headers,
        data: response.data
      });
    }

    return response.data.data;
  });
}

function withDefaults(request$1, newDefaults) {
  const newRequest = request$1.defaults(newDefaults);

  const newApi = (query, options) => {
    return graphql(newRequest, query, options);
  };

  return Object.assign(newApi, {
    defaults: withDefaults.bind(null, newRequest),
    endpoint: request.request.endpoint
  });
}

const graphql$1 = withDefaults(request.request, {
  headers: {
    "user-agent": `octokit-graphql.js/${VERSION} ${universalUserAgent.getUserAgent()}`
  },
  method: "POST",
  url: "/graphql"
});
function withCustomRequest(customRequest) {
  return withDefaults(customRequest, {
    method: "POST",
    url: "/graphql"
  });
}

exports.graphql = graphql$1;
exports.withCustomRequest = withCustomRequest;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 669:
/***/ (function(module) {

module.exports = require("util");

/***/ }),

/***/ 670:
/***/ (function(module) {

module.exports = register

function register (state, name, method, options) {
  if (typeof method !== 'function') {
    throw new Error('method for before hook must be a function')
  }

  if (!options) {
    options = {}
  }

  if (Array.isArray(name)) {
    return name.reverse().reduce(function (callback, name) {
      return register.bind(null, state, name, callback, options)
    }, method)()
  }

  return Promise.resolve()
    .then(function () {
      if (!state.registry[name]) {
        return method(options)
      }

      return (state.registry[name]).reduce(function (method, registered) {
        return registered.hook.bind(null, method, options)
      }, method)()
    })
}


/***/ }),

/***/ 678:
/***/ (function(module, exports) {

"use strict";

/// <reference lib="es2018"/>
/// <reference lib="dom"/>
/// <reference types="node"/>
Object.defineProperty(exports, "__esModule", { value: true });
const typedArrayTypeNames = [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array'
];
function isTypedArrayName(name) {
    return typedArrayTypeNames.includes(name);
}
const objectTypeNames = [
    'Function',
    'Generator',
    'AsyncGenerator',
    'GeneratorFunction',
    'AsyncGeneratorFunction',
    'AsyncFunction',
    'Observable',
    'Array',
    'Buffer',
    'Object',
    'RegExp',
    'Date',
    'Error',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'ArrayBuffer',
    'SharedArrayBuffer',
    'DataView',
    'Promise',
    'URL',
    'HTMLElement',
    ...typedArrayTypeNames
];
function isObjectTypeName(name) {
    return objectTypeNames.includes(name);
}
const primitiveTypeNames = [
    'null',
    'undefined',
    'string',
    'number',
    'bigint',
    'boolean',
    'symbol'
];
function isPrimitiveTypeName(name) {
    return primitiveTypeNames.includes(name);
}
// eslint-disable-next-line @typescript-eslint/ban-types
function isOfType(type) {
    return (value) => typeof value === type;
}
const { toString } = Object.prototype;
const getObjectType = (value) => {
    const objectTypeName = toString.call(value).slice(8, -1);
    if (/HTML\w+Element/.test(objectTypeName) && is.domElement(value)) {
        return 'HTMLElement';
    }
    if (isObjectTypeName(objectTypeName)) {
        return objectTypeName;
    }
    return undefined;
};
const isObjectOfType = (type) => (value) => getObjectType(value) === type;
function is(value) {
    if (value === null) {
        return 'null';
    }
    switch (typeof value) {
        case 'undefined':
            return 'undefined';
        case 'string':
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'function':
            return 'Function';
        case 'bigint':
            return 'bigint';
        case 'symbol':
            return 'symbol';
        default:
    }
    if (is.observable(value)) {
        return 'Observable';
    }
    if (is.array(value)) {
        return 'Array';
    }
    if (is.buffer(value)) {
        return 'Buffer';
    }
    const tagType = getObjectType(value);
    if (tagType) {
        return tagType;
    }
    if (value instanceof String || value instanceof Boolean || value instanceof Number) {
        throw new TypeError('Please don\'t use object wrappers for primitive types');
    }
    return 'Object';
}
is.undefined = isOfType('undefined');
is.string = isOfType('string');
const isNumberType = isOfType('number');
is.number = (value) => isNumberType(value) && !is.nan(value);
is.bigint = isOfType('bigint');
// eslint-disable-next-line @typescript-eslint/ban-types
is.function_ = isOfType('function');
is.null_ = (value) => value === null;
is.class_ = (value) => is.function_(value) && value.toString().startsWith('class ');
is.boolean = (value) => value === true || value === false;
is.symbol = isOfType('symbol');
is.numericString = (value) => is.string(value) && !is.emptyStringOrWhitespace(value) && !Number.isNaN(Number(value));
is.array = (value, assertion) => {
    if (!Array.isArray(value)) {
        return false;
    }
    if (!is.function_(assertion)) {
        return true;
    }
    return value.every(assertion);
};
is.buffer = (value) => { var _a, _b, _c, _d; return (_d = (_c = (_b = (_a = value) === null || _a === void 0 ? void 0 : _a.constructor) === null || _b === void 0 ? void 0 : _b.isBuffer) === null || _c === void 0 ? void 0 : _c.call(_b, value)) !== null && _d !== void 0 ? _d : false; };
is.nullOrUndefined = (value) => is.null_(value) || is.undefined(value);
is.object = (value) => !is.null_(value) && (typeof value === 'object' || is.function_(value));
is.iterable = (value) => { var _a; return is.function_((_a = value) === null || _a === void 0 ? void 0 : _a[Symbol.iterator]); };
is.asyncIterable = (value) => { var _a; return is.function_((_a = value) === null || _a === void 0 ? void 0 : _a[Symbol.asyncIterator]); };
is.generator = (value) => is.iterable(value) && is.function_(value.next) && is.function_(value.throw);
is.asyncGenerator = (value) => is.asyncIterable(value) && is.function_(value.next) && is.function_(value.throw);
is.nativePromise = (value) => isObjectOfType('Promise')(value);
const hasPromiseAPI = (value) => {
    var _a, _b;
    return is.function_((_a = value) === null || _a === void 0 ? void 0 : _a.then) &&
        is.function_((_b = value) === null || _b === void 0 ? void 0 : _b.catch);
};
is.promise = (value) => is.nativePromise(value) || hasPromiseAPI(value);
is.generatorFunction = isObjectOfType('GeneratorFunction');
is.asyncGeneratorFunction = (value) => getObjectType(value) === 'AsyncGeneratorFunction';
is.asyncFunction = (value) => getObjectType(value) === 'AsyncFunction';
// eslint-disable-next-line no-prototype-builtins, @typescript-eslint/ban-types
is.boundFunction = (value) => is.function_(value) && !value.hasOwnProperty('prototype');
is.regExp = isObjectOfType('RegExp');
is.date = isObjectOfType('Date');
is.error = isObjectOfType('Error');
is.map = (value) => isObjectOfType('Map')(value);
is.set = (value) => isObjectOfType('Set')(value);
is.weakMap = (value) => isObjectOfType('WeakMap')(value);
is.weakSet = (value) => isObjectOfType('WeakSet')(value);
is.int8Array = isObjectOfType('Int8Array');
is.uint8Array = isObjectOfType('Uint8Array');
is.uint8ClampedArray = isObjectOfType('Uint8ClampedArray');
is.int16Array = isObjectOfType('Int16Array');
is.uint16Array = isObjectOfType('Uint16Array');
is.int32Array = isObjectOfType('Int32Array');
is.uint32Array = isObjectOfType('Uint32Array');
is.float32Array = isObjectOfType('Float32Array');
is.float64Array = isObjectOfType('Float64Array');
is.bigInt64Array = isObjectOfType('BigInt64Array');
is.bigUint64Array = isObjectOfType('BigUint64Array');
is.arrayBuffer = isObjectOfType('ArrayBuffer');
is.sharedArrayBuffer = isObjectOfType('SharedArrayBuffer');
is.dataView = isObjectOfType('DataView');
is.directInstanceOf = (instance, class_) => Object.getPrototypeOf(instance) === class_.prototype;
is.urlInstance = (value) => isObjectOfType('URL')(value);
is.urlString = (value) => {
    if (!is.string(value)) {
        return false;
    }
    try {
        new URL(value); // eslint-disable-line no-new
        return true;
    }
    catch (_a) {
        return false;
    }
};
// TODO: Use the `not` operator with a type guard here when it's available.
// Example: `is.truthy = (value: unknown): value is (not false | not 0 | not '' | not undefined | not null) => Boolean(value);`
is.truthy = (value) => Boolean(value);
// Example: `is.falsy = (value: unknown): value is (not true | 0 | '' | undefined | null) => Boolean(value);`
is.falsy = (value) => !value;
is.nan = (value) => Number.isNaN(value);
is.primitive = (value) => is.null_(value) || isPrimitiveTypeName(typeof value);
is.integer = (value) => Number.isInteger(value);
is.safeInteger = (value) => Number.isSafeInteger(value);
is.plainObject = (value) => {
    // From: https://github.com/sindresorhus/is-plain-obj/blob/master/index.js
    if (toString.call(value) !== '[object Object]') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.getPrototypeOf({});
};
is.typedArray = (value) => isTypedArrayName(getObjectType(value));
const isValidLength = (value) => is.safeInteger(value) && value >= 0;
is.arrayLike = (value) => !is.nullOrUndefined(value) && !is.function_(value) && isValidLength(value.length);
is.inRange = (value, range) => {
    if (is.number(range)) {
        return value >= Math.min(0, range) && value <= Math.max(range, 0);
    }
    if (is.array(range) && range.length === 2) {
        return value >= Math.min(...range) && value <= Math.max(...range);
    }
    throw new TypeError(`Invalid range: ${JSON.stringify(range)}`);
};
const NODE_TYPE_ELEMENT = 1;
const DOM_PROPERTIES_TO_CHECK = [
    'innerHTML',
    'ownerDocument',
    'style',
    'attributes',
    'nodeValue'
];
is.domElement = (value) => {
    return is.object(value) &&
        value.nodeType === NODE_TYPE_ELEMENT &&
        is.string(value.nodeName) &&
        !is.plainObject(value) &&
        DOM_PROPERTIES_TO_CHECK.every(property => property in value);
};
is.observable = (value) => {
    var _a, _b, _c, _d;
    if (!value) {
        return false;
    }
    // eslint-disable-next-line no-use-extend-native/no-use-extend-native
    if (value === ((_b = (_a = value)[Symbol.observable]) === null || _b === void 0 ? void 0 : _b.call(_a))) {
        return true;
    }
    if (value === ((_d = (_c = value)['@@observable']) === null || _d === void 0 ? void 0 : _d.call(_c))) {
        return true;
    }
    return false;
};
is.nodeStream = (value) => is.object(value) && is.function_(value.pipe) && !is.observable(value);
is.infinite = (value) => value === Infinity || value === -Infinity;
const isAbsoluteMod2 = (remainder) => (value) => is.integer(value) && Math.abs(value % 2) === remainder;
is.evenInteger = isAbsoluteMod2(0);
is.oddInteger = isAbsoluteMod2(1);
is.emptyArray = (value) => is.array(value) && value.length === 0;
is.nonEmptyArray = (value) => is.array(value) && value.length > 0;
is.emptyString = (value) => is.string(value) && value.length === 0;
// TODO: Use `not ''` when the `not` operator is available.
is.nonEmptyString = (value) => is.string(value) && value.length > 0;
const isWhiteSpaceString = (value) => is.string(value) && !/\S/.test(value);
is.emptyStringOrWhitespace = (value) => is.emptyString(value) || isWhiteSpaceString(value);
is.emptyObject = (value) => is.object(value) && !is.map(value) && !is.set(value) && Object.keys(value).length === 0;
// TODO: Use `not` operator here to remove `Map` and `Set` from type guard:
// - https://github.com/Microsoft/TypeScript/pull/29317
is.nonEmptyObject = (value) => is.object(value) && !is.map(value) && !is.set(value) && Object.keys(value).length > 0;
is.emptySet = (value) => is.set(value) && value.size === 0;
is.nonEmptySet = (value) => is.set(value) && value.size > 0;
is.emptyMap = (value) => is.map(value) && value.size === 0;
is.nonEmptyMap = (value) => is.map(value) && value.size > 0;
const predicateOnArray = (method, predicate, values) => {
    if (!is.function_(predicate)) {
        throw new TypeError(`Invalid predicate: ${JSON.stringify(predicate)}`);
    }
    if (values.length === 0) {
        throw new TypeError('Invalid number of values');
    }
    return method.call(values, predicate);
};
is.any = (predicate, ...values) => {
    const predicates = is.array(predicate) ? predicate : [predicate];
    return predicates.some(singlePredicate => predicateOnArray(Array.prototype.some, singlePredicate, values));
};
is.all = (predicate, ...values) => predicateOnArray(Array.prototype.every, predicate, values);
const assertType = (condition, description, value) => {
    if (!condition) {
        throw new TypeError(`Expected value which is \`${description}\`, received value of type \`${is(value)}\`.`);
    }
};
exports.assert = {
    // Unknowns.
    undefined: (value) => assertType(is.undefined(value), 'undefined', value),
    string: (value) => assertType(is.string(value), 'string', value),
    number: (value) => assertType(is.number(value), 'number', value),
    bigint: (value) => assertType(is.bigint(value), 'bigint', value),
    // eslint-disable-next-line @typescript-eslint/ban-types
    function_: (value) => assertType(is.function_(value), 'Function', value),
    null_: (value) => assertType(is.null_(value), 'null', value),
    class_: (value) => assertType(is.class_(value), "Class" /* class_ */, value),
    boolean: (value) => assertType(is.boolean(value), 'boolean', value),
    symbol: (value) => assertType(is.symbol(value), 'symbol', value),
    numericString: (value) => assertType(is.numericString(value), "string with a number" /* numericString */, value),
    array: (value, assertion) => {
        const assert = assertType;
        assert(is.array(value), 'Array', value);
        if (assertion) {
            value.forEach(assertion);
        }
    },
    buffer: (value) => assertType(is.buffer(value), 'Buffer', value),
    nullOrUndefined: (value) => assertType(is.nullOrUndefined(value), "null or undefined" /* nullOrUndefined */, value),
    object: (value) => assertType(is.object(value), 'Object', value),
    iterable: (value) => assertType(is.iterable(value), "Iterable" /* iterable */, value),
    asyncIterable: (value) => assertType(is.asyncIterable(value), "AsyncIterable" /* asyncIterable */, value),
    generator: (value) => assertType(is.generator(value), 'Generator', value),
    asyncGenerator: (value) => assertType(is.asyncGenerator(value), 'AsyncGenerator', value),
    nativePromise: (value) => assertType(is.nativePromise(value), "native Promise" /* nativePromise */, value),
    promise: (value) => assertType(is.promise(value), 'Promise', value),
    generatorFunction: (value) => assertType(is.generatorFunction(value), 'GeneratorFunction', value),
    asyncGeneratorFunction: (value) => assertType(is.asyncGeneratorFunction(value), 'AsyncGeneratorFunction', value),
    // eslint-disable-next-line @typescript-eslint/ban-types
    asyncFunction: (value) => assertType(is.asyncFunction(value), 'AsyncFunction', value),
    // eslint-disable-next-line @typescript-eslint/ban-types
    boundFunction: (value) => assertType(is.boundFunction(value), 'Function', value),
    regExp: (value) => assertType(is.regExp(value), 'RegExp', value),
    date: (value) => assertType(is.date(value), 'Date', value),
    error: (value) => assertType(is.error(value), 'Error', value),
    map: (value) => assertType(is.map(value), 'Map', value),
    set: (value) => assertType(is.set(value), 'Set', value),
    weakMap: (value) => assertType(is.weakMap(value), 'WeakMap', value),
    weakSet: (value) => assertType(is.weakSet(value), 'WeakSet', value),
    int8Array: (value) => assertType(is.int8Array(value), 'Int8Array', value),
    uint8Array: (value) => assertType(is.uint8Array(value), 'Uint8Array', value),
    uint8ClampedArray: (value) => assertType(is.uint8ClampedArray(value), 'Uint8ClampedArray', value),
    int16Array: (value) => assertType(is.int16Array(value), 'Int16Array', value),
    uint16Array: (value) => assertType(is.uint16Array(value), 'Uint16Array', value),
    int32Array: (value) => assertType(is.int32Array(value), 'Int32Array', value),
    uint32Array: (value) => assertType(is.uint32Array(value), 'Uint32Array', value),
    float32Array: (value) => assertType(is.float32Array(value), 'Float32Array', value),
    float64Array: (value) => assertType(is.float64Array(value), 'Float64Array', value),
    bigInt64Array: (value) => assertType(is.bigInt64Array(value), 'BigInt64Array', value),
    bigUint64Array: (value) => assertType(is.bigUint64Array(value), 'BigUint64Array', value),
    arrayBuffer: (value) => assertType(is.arrayBuffer(value), 'ArrayBuffer', value),
    sharedArrayBuffer: (value) => assertType(is.sharedArrayBuffer(value), 'SharedArrayBuffer', value),
    dataView: (value) => assertType(is.dataView(value), 'DataView', value),
    urlInstance: (value) => assertType(is.urlInstance(value), 'URL', value),
    urlString: (value) => assertType(is.urlString(value), "string with a URL" /* urlString */, value),
    truthy: (value) => assertType(is.truthy(value), "truthy" /* truthy */, value),
    falsy: (value) => assertType(is.falsy(value), "falsy" /* falsy */, value),
    nan: (value) => assertType(is.nan(value), "NaN" /* nan */, value),
    primitive: (value) => assertType(is.primitive(value), "primitive" /* primitive */, value),
    integer: (value) => assertType(is.integer(value), "integer" /* integer */, value),
    safeInteger: (value) => assertType(is.safeInteger(value), "integer" /* safeInteger */, value),
    plainObject: (value) => assertType(is.plainObject(value), "plain object" /* plainObject */, value),
    typedArray: (value) => assertType(is.typedArray(value), "TypedArray" /* typedArray */, value),
    arrayLike: (value) => assertType(is.arrayLike(value), "array-like" /* arrayLike */, value),
    domElement: (value) => assertType(is.domElement(value), "HTMLElement" /* domElement */, value),
    observable: (value) => assertType(is.observable(value), 'Observable', value),
    nodeStream: (value) => assertType(is.nodeStream(value), "Node.js Stream" /* nodeStream */, value),
    infinite: (value) => assertType(is.infinite(value), "infinite number" /* infinite */, value),
    emptyArray: (value) => assertType(is.emptyArray(value), "empty array" /* emptyArray */, value),
    nonEmptyArray: (value) => assertType(is.nonEmptyArray(value), "non-empty array" /* nonEmptyArray */, value),
    emptyString: (value) => assertType(is.emptyString(value), "empty string" /* emptyString */, value),
    nonEmptyString: (value) => assertType(is.nonEmptyString(value), "non-empty string" /* nonEmptyString */, value),
    emptyStringOrWhitespace: (value) => assertType(is.emptyStringOrWhitespace(value), "empty string or whitespace" /* emptyStringOrWhitespace */, value),
    emptyObject: (value) => assertType(is.emptyObject(value), "empty object" /* emptyObject */, value),
    nonEmptyObject: (value) => assertType(is.nonEmptyObject(value), "non-empty object" /* nonEmptyObject */, value),
    emptySet: (value) => assertType(is.emptySet(value), "empty set" /* emptySet */, value),
    nonEmptySet: (value) => assertType(is.nonEmptySet(value), "non-empty set" /* nonEmptySet */, value),
    emptyMap: (value) => assertType(is.emptyMap(value), "empty map" /* emptyMap */, value),
    nonEmptyMap: (value) => assertType(is.nonEmptyMap(value), "non-empty map" /* nonEmptyMap */, value),
    // Numbers.
    evenInteger: (value) => assertType(is.evenInteger(value), "even integer" /* evenInteger */, value),
    oddInteger: (value) => assertType(is.oddInteger(value), "odd integer" /* oddInteger */, value),
    // Two arguments.
    directInstanceOf: (instance, class_) => assertType(is.directInstanceOf(instance, class_), "T" /* directInstanceOf */, instance),
    inRange: (value, range) => assertType(is.inRange(value, range), "in range" /* inRange */, value),
    // Variadic functions.
    any: (predicate, ...values) => assertType(is.any(predicate, ...values), "predicate returns truthy for any value" /* any */, values),
    all: (predicate, ...values) => assertType(is.all(predicate, ...values), "predicate returns truthy for all values" /* all */, values)
};
// Some few keywords are reserved, but we'll populate them for Node.js users
// See https://github.com/Microsoft/TypeScript/issues/2536
Object.defineProperties(is, {
    class: {
        value: is.class_
    },
    function: {
        value: is.function_
    },
    null: {
        value: is.null_
    }
});
Object.defineProperties(exports.assert, {
    class: {
        value: exports.assert.class_
    },
    function: {
        value: exports.assert.function_
    },
    null: {
        value: exports.assert.null_
    }
});
exports.default = is;
// For CommonJS default export support
module.exports = is;
module.exports.default = is;
module.exports.assert = exports.assert;


/***/ }),

/***/ 682:
/***/ (function(module, __unusedexports, __webpack_require__) {

var register = __webpack_require__(670)
var addHook = __webpack_require__(549)
var removeHook = __webpack_require__(819)

// bind with array of arguments: https://stackoverflow.com/a/21792913
var bind = Function.bind
var bindable = bind.bind(bind)

function bindApi (hook, state, name) {
  var removeHookRef = bindable(removeHook, null).apply(null, name ? [state, name] : [state])
  hook.api = { remove: removeHookRef }
  hook.remove = removeHookRef

  ;['before', 'error', 'after', 'wrap'].forEach(function (kind) {
    var args = name ? [state, kind, name] : [state, kind]
    hook[kind] = hook.api[kind] = bindable(addHook, null).apply(null, args)
  })
}

function HookSingular () {
  var singularHookName = 'h'
  var singularHookState = {
    registry: {}
  }
  var singularHook = register.bind(null, singularHookState, singularHookName)
  bindApi(singularHook, singularHookState, singularHookName)
  return singularHook
}

function HookCollection () {
  var state = {
    registry: {}
  }

  var hook = register.bind(null, state)
  bindApi(hook, state)

  return hook
}

var collectionHookDeprecationMessageDisplayed = false
function Hook () {
  if (!collectionHookDeprecationMessageDisplayed) {
    console.warn('[before-after-hook]: "Hook()" repurposing warning, use "Hook.Collection()". Read more: https://git.io/upgrade-before-after-hook-to-1.4')
    collectionHookDeprecationMessageDisplayed = true
  }
  return HookCollection()
}

Hook.Singular = HookSingular.bind()
Hook.Collection = HookCollection.bind()

module.exports = Hook
// expose constructors as a named property for TypeScript
module.exports.Hook = Hook
module.exports.Singular = Hook.Singular
module.exports.Collection = Hook.Collection


/***/ }),

/***/ 683:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


var trigram = __webpack_require__(262).trigram
var collapse = __webpack_require__(201)
var trim = __webpack_require__(65)

var has = {}.hasOwnProperty

exports.clean = clean
exports.trigrams = getCleanTrigrams
exports.asDictionary = getCleanTrigramsAsDictionary
exports.asTuples = getCleanTrigramsAsTuples
exports.tuplesAsDictionary = getCleanTrigramTuplesAsDictionary

// Clean `value`/
// Removed general non-important (as in, for language detection) punctuation
// marks, symbols, and numbers.
function clean(value) {
  if (value === null || value === undefined) {
    return ''
  }

  return trim(
    collapse(String(value).replace(/[\u0021-\u0040]+/g, ' '))
  ).toLowerCase()
}

// Get clean, padded, trigrams.
function getCleanTrigrams(value) {
  return trigram(' ' + clean(value) + ' ')
}

// Get an `Object` with trigrams as its attributes, and their occurence count as
// their values.
function getCleanTrigramsAsDictionary(value) {
  var trigrams = getCleanTrigrams(value)
  var index = trigrams.length
  var dictionary = {}
  var trigram

  while (index--) {
    trigram = trigrams[index]

    if (has.call(dictionary, trigram)) {
      dictionary[trigram]++
    } else {
      dictionary[trigram] = 1
    }
  }

  return dictionary
}

// Get an `Array` containing trigram--count tuples from a given value.
function getCleanTrigramsAsTuples(value) {
  var dictionary = getCleanTrigramsAsDictionary(value)
  var tuples = []
  var trigram

  for (trigram in dictionary) {
    tuples.push([trigram, dictionary[trigram]])
  }

  tuples.sort(sort)

  return tuples
}

// Get an `Array` containing trigram--count tuples from a given value.
function getCleanTrigramTuplesAsDictionary(tuples) {
  var index = tuples.length
  var dictionary = {}
  var tuple

  while (index--) {
    tuple = tuples[index]
    dictionary[tuple[0]] = tuple[1]
  }

  return dictionary
}

// Deep regular sort on item at `1` in both `Object`s.
function sort(a, b) {
  return a[1] - b[1]
}


/***/ }),

/***/ 686:
/***/ (function(module) {

"use strict";

/* istanbul ignore file: https://github.com/nodejs/node/blob/a91293d4d9ab403046ab5eb022332e4e3d249bd3/lib/internal/url.js#L1257 */

module.exports = url => {
	const options = {
		protocol: url.protocol,
		hostname: typeof url.hostname === 'string' && url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
		host: url.host,
		hash: url.hash,
		search: url.search,
		pathname: url.pathname,
		href: url.href,
		path: `${url.pathname || ''}${url.search || ''}`
	};

	if (typeof url.port === 'string' && url.port.length !== 0) {
		options.port = Number(url.port);
	}

	if (url.username || url.password) {
		options.auth = `${url.username || ''}:${url.password || ''}`;
	}

	return options;
};


/***/ }),

/***/ 717:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

// For internal use, subject to change.
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
// We use any as a valid input type
/* eslint-disable @typescript-eslint/no-explicit-any */
const fs = __importStar(__webpack_require__(747));
const os = __importStar(__webpack_require__(87));
const utils_1 = __webpack_require__(278);
function issueCommand(command, message) {
    const filePath = process.env[`GITHUB_${command}`];
    if (!filePath) {
        throw new Error(`Unable to find environment variable for file command ${command}`);
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing file at path: ${filePath}`);
    }
    fs.appendFileSync(filePath, `${utils_1.toCommandValue(message)}${os.EOL}`, {
        encoding: 'utf8'
    });
}
exports.issueCommand = issueCommand;
//# sourceMappingURL=file-command.js.map

/***/ }),

/***/ 747:
/***/ (function(module) {

module.exports = require("fs");

/***/ }),

/***/ 761:
/***/ (function(module) {

module.exports = require("zlib");

/***/ }),

/***/ 762:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

var universalUserAgent = __webpack_require__(429);
var beforeAfterHook = __webpack_require__(682);
var request = __webpack_require__(234);
var graphql = __webpack_require__(668);
var authToken = __webpack_require__(334);

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;

  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }

  return target;
}

function _objectWithoutProperties(source, excluded) {
  if (source == null) return {};

  var target = _objectWithoutPropertiesLoose(source, excluded);

  var key, i;

  if (Object.getOwnPropertySymbols) {
    var sourceSymbolKeys = Object.getOwnPropertySymbols(source);

    for (i = 0; i < sourceSymbolKeys.length; i++) {
      key = sourceSymbolKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
      target[key] = source[key];
    }
  }

  return target;
}

const VERSION = "3.2.1";

class Octokit {
  constructor(options = {}) {
    const hook = new beforeAfterHook.Collection();
    const requestDefaults = {
      baseUrl: request.request.endpoint.DEFAULTS.baseUrl,
      headers: {},
      request: Object.assign({}, options.request, {
        hook: hook.bind(null, "request")
      }),
      mediaType: {
        previews: [],
        format: ""
      }
    }; // prepend default user agent with `options.userAgent` if set

    requestDefaults.headers["user-agent"] = [options.userAgent, `octokit-core.js/${VERSION} ${universalUserAgent.getUserAgent()}`].filter(Boolean).join(" ");

    if (options.baseUrl) {
      requestDefaults.baseUrl = options.baseUrl;
    }

    if (options.previews) {
      requestDefaults.mediaType.previews = options.previews;
    }

    if (options.timeZone) {
      requestDefaults.headers["time-zone"] = options.timeZone;
    }

    this.request = request.request.defaults(requestDefaults);
    this.graphql = graphql.withCustomRequest(this.request).defaults(requestDefaults);
    this.log = Object.assign({
      debug: () => {},
      info: () => {},
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    }, options.log);
    this.hook = hook; // (1) If neither `options.authStrategy` nor `options.auth` are set, the `octokit` instance
    //     is unauthenticated. The `this.auth()` method is a no-op and no request hook is registered.
    // (2) If only `options.auth` is set, use the default token authentication strategy.
    // (3) If `options.authStrategy` is set then use it and pass in `options.auth`. Always pass own request as many strategies accept a custom request instance.
    // TODO: type `options.auth` based on `options.authStrategy`.

    if (!options.authStrategy) {
      if (!options.auth) {
        // (1)
        this.auth = async () => ({
          type: "unauthenticated"
        });
      } else {
        // (2)
        const auth = authToken.createTokenAuth(options.auth); // @ts-ignore  ¯\_(ツ)_/¯

        hook.wrap("request", auth.hook);
        this.auth = auth;
      }
    } else {
      const {
        authStrategy
      } = options,
            otherOptions = _objectWithoutProperties(options, ["authStrategy"]);

      const auth = authStrategy(Object.assign({
        request: this.request,
        log: this.log,
        // we pass the current octokit instance as well as its constructor options
        // to allow for authentication strategies that return a new octokit instance
        // that shares the same internal state as the current one. The original
        // requirement for this was the "event-octokit" authentication strategy
        // of https://github.com/probot/octokit-auth-probot.
        octokit: this,
        octokitOptions: otherOptions
      }, options.auth)); // @ts-ignore  ¯\_(ツ)_/¯

      hook.wrap("request", auth.hook);
      this.auth = auth;
    } // apply plugins
    // https://stackoverflow.com/a/16345172


    const classConstructor = this.constructor;
    classConstructor.plugins.forEach(plugin => {
      Object.assign(this, plugin(this, options));
    });
  }

  static defaults(defaults) {
    const OctokitWithDefaults = class extends this {
      constructor(...args) {
        const options = args[0] || {};

        if (typeof defaults === "function") {
          super(defaults(options));
          return;
        }

        super(Object.assign({}, defaults, options, options.userAgent && defaults.userAgent ? {
          userAgent: `${options.userAgent} ${defaults.userAgent}`
        } : null));
      }

    };
    return OctokitWithDefaults;
  }
  /**
   * Attach a plugin (or many) to your Octokit instance.
   *
   * @example
   * const API = Octokit.plugin(plugin1, plugin2, plugin3, ...)
   */


  static plugin(...newPlugins) {
    var _a;

    const currentPlugins = this.plugins;
    const NewOctokit = (_a = class extends this {}, _a.plugins = currentPlugins.concat(newPlugins.filter(plugin => !currentPlugins.includes(plugin))), _a);
    return NewOctokit;
  }

}
Octokit.VERSION = VERSION;
Octokit.plugins = [];

exports.Octokit = Octokit;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 771:
/***/ (function(module, __unusedexports, __webpack_require__) {

const languages = __webpack_require__(46);
const tokenGenerator = __webpack_require__(185);
const querystring = __webpack_require__(191);
const got = __webpack_require__(61);

/**
 * @function translate
 * @param {String} text The text to be translated.
 * @param {Object} options The options object for the translator.
 * @returns {Object} The result containing the translation.
 */
async function translate(text, options) {
    try {
        if (typeof options !== "object") options = {};
        text = String(text);

        // Check if a lanugage is in supported; if not, throw an error object.
        let error;
        [ options.from, options.to ].forEach((lang) => {
            if (lang && !languages.isSupported(lang)) {
                error = new Error();
                error.code = 400;
                error.message = `The language '${lang}' is not supported.`;
            }
        });
        if (error) throw error;

        // If options object doesn"t have "from" language, set it to "auto".
        if (!Object.prototype.hasOwnProperty.call(options, "from")) options.from = "auto";
        // If options object doesn"t have "to" language, set it to "en".
        if (!Object.prototype.hasOwnProperty.call(options, "to")) options.to = "en";
        // If options object has a "raw" property evaluating to true, set it to true.
        options.raw = Boolean(options.raw);

        // Get ISO 639-1 codes for the languages.
        options.from = languages.getISOCode(options.from);
        options.to = languages.getISOCode(options.to);

        // Generate Google Translate token for the text to be translated.
        let token = await tokenGenerator.generate(text);

        // URL & query string required by Google Translate.
        let baseUrl = "https://translate.google.com/translate_a/single";
        let data = {
            client: "gtx",
            sl: options.from,
            tl: options.to,
            hl: options.to,
            dt: [ "at", "bd", "ex", "ld", "md", "qca", "rw", "rm", "ss", "t" ],
            ie: "UTF-8",
            oe: "UTF-8",
            otf: 1,
            ssel: 0,
            tsel: 0,
            kc: 7,
            q: text,
            [token.name]: token.value
        };

        // Append query string to the request URL.
        let url = `${baseUrl}?${querystring.stringify(data)}`;

        let requestOptions;
        // If request URL is greater than 2048 characters, use POST method.
        if (url.length > 2048) {
            delete data.q;
            requestOptions = [
                `${baseUrl}?${querystring.stringify(data)}`,
                {
                    method: "POST",
                    form: {
                        q: text
                    }
                }
            ];
        }
        else {
            requestOptions = [ url ];
        }

        // Request translation from Google Translate.
        let response = await got(...requestOptions);

        let result = {
            text: "",
            from: {
                language: {
                    didYouMean: false,
                    iso: ""
                },
                text: {
                    autoCorrected: false,
                    value: "",
                    didYouMean: false
                }
            },
            raw: ""
        };

        // If user requested a raw output, add the raw response to the result
        if (options.raw) {
            result.raw = response.body;
        }

        // Parse string body to JSON and add it to result object.

        let body = JSON.parse(response.body);
        body[0].forEach((obj) => {
            if (obj[0]) {
                result.text += obj[0];
            }
        });

        if (body[2] === body[8][0][0]) {
            result.from.language.iso = body[2];
        }
        else {
            result.from.language.didYouMean = true;
            result.from.language.iso = body[8][0][0];
        }

        if (body[7] && body[7][0]) {
            let str = body[7][0];

            str = str.replace(/<b><i>/g, "[");
            str = str.replace(/<\/i><\/b>/g, "]");

            result.from.text.value = str;

            if (body[7][5] === true) {
                result.from.text.autoCorrected = true;
            }
            else {
                result.from.text.didYouMean = true;
            }
        }

        return result;
    }
    catch (e) {
        if (e.name === "HTTPError") {
            let error = new Error();
            error.name = e.name;
            error.statusCode = e.statusCode;
            error.statusMessage = e.statusMessage;
            throw error;
        }
        throw e;
    }
}

module.exports = translate;
module.exports.languages = languages;


/***/ }),

/***/ 813:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const is_1 = __webpack_require__(678);
exports.default = (body) => is_1.default.nodeStream(body) && is_1.default.function_(body.getBoundary);


/***/ }),

/***/ 818:
/***/ (function(module) {

"use strict";


module.exports = (from, to, events) => {
	for (const event of events) {
		from.on(event, (...args) => to.emit(event, ...args));
	}
};


/***/ }),

/***/ 819:
/***/ (function(module) {

module.exports = removeHook

function removeHook (state, name, method) {
  if (!state.registry[name]) {
    return
  }

  var index = state.registry[name]
    .map(function (registered) { return registered.orig })
    .indexOf(method)

  if (index === -1) {
    return
  }

  state.registry[name].splice(index, 1)
}


/***/ }),

/***/ 820:
/***/ (function(__unusedmodule, exports) {

//TODO: handle reviver/dehydrate function like normal
//and handle indentation, like normal.
//if anyone needs this... please send pull request.

exports.stringify = function stringify (o) {
  if('undefined' == typeof o) return o

  if(o && Buffer.isBuffer(o))
    return JSON.stringify(':base64:' + o.toString('base64'))

  if(o && o.toJSON)
    o =  o.toJSON()

  if(o && 'object' === typeof o) {
    var s = ''
    var array = Array.isArray(o)
    s = array ? '[' : '{'
    var first = true

    for(var k in o) {
      var ignore = 'function' == typeof o[k] || (!array && 'undefined' === typeof o[k])
      if(Object.hasOwnProperty.call(o, k) && !ignore) {
        if(!first)
          s += ','
        first = false
        if (array) {
          if(o[k] == undefined)
            s += 'null'
          else
            s += stringify(o[k])
        } else if (o[k] !== void(0)) {
          s += stringify(k) + ':' + stringify(o[k])
        }
      }
    }

    s += array ? ']' : '}'

    return s
  } else if ('string' === typeof o) {
    return JSON.stringify(/^:/.test(o) ? ':' + o : o)
  } else if ('undefined' === typeof o) {
    return 'null';
  } else
    return JSON.stringify(o)
}

exports.parse = function (s) {
  return JSON.parse(s, function (key, value) {
    if('string' === typeof value) {
      if(/^:base64:/.test(value))
        return Buffer.from(value.substring(8), 'base64')
      else
        return /^:/.test(value) ? value.substring(1) : value 
    }
    return value
  })
}


/***/ }),

/***/ 831:
/***/ (function(module) {

"use strict";


// We define these manually to ensure they're always copied
// even if they would move up the prototype chain
// https://nodejs.org/api/http.html#http_class_http_incomingmessage
const knownProperties = [
	'aborted',
	'complete',
	'headers',
	'httpVersion',
	'httpVersionMinor',
	'httpVersionMajor',
	'method',
	'rawHeaders',
	'rawTrailers',
	'setTimeout',
	'socket',
	'statusCode',
	'statusMessage',
	'trailers',
	'url'
];

module.exports = (fromStream, toStream) => {
	if (toStream._readableState.autoDestroy) {
		throw new Error('The second stream must have the `autoDestroy` option set to `false`');
	}

	const fromProperties = new Set(Object.keys(fromStream).concat(knownProperties));

	const properties = {};

	for (const property of fromProperties) {
		// Don't overwrite existing properties.
		if (property in toStream) {
			continue;
		}

		properties[property] = {
			get() {
				const value = fromStream[property];
				const isFunction = typeof value === 'function';

				return isFunction ? value.bind(fromStream) : value;
			},
			set(value) {
				fromStream[property] = value;
			},
			enumerable: true,
			configurable: false
		};
	}

	Object.defineProperties(toStream, properties);

	fromStream.once('aborted', () => {
		toStream.destroy();

		toStream.emit('aborted');
	});

	fromStream.once('close', () => {
		if (fromStream.complete) {
			if (toStream.readable) {
				toStream.once('end', () => {
					toStream.emit('close');
				});
			} else {
				toStream.emit('close');
			}
		} else {
			toStream.emit('close');
		}
	});

	return toStream;
};


/***/ }),

/***/ 835:
/***/ (function(module) {

module.exports = require("url");

/***/ }),

/***/ 877:
/***/ (function(module) {

module.exports = eval("require")("encoding");


/***/ }),

/***/ 881:
/***/ (function(module) {

module.exports = require("dns");

/***/ }),

/***/ 898:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const EventEmitter = __webpack_require__(614);
const tls = __webpack_require__(16);
const http2 = __webpack_require__(565);
const QuickLRU = __webpack_require__(273);

const kCurrentStreamsCount = Symbol('currentStreamsCount');
const kRequest = Symbol('request');
const kOriginSet = Symbol('cachedOriginSet');
const kGracefullyClosing = Symbol('gracefullyClosing');

const nameKeys = [
	// `http2.connect()` options
	'maxDeflateDynamicTableSize',
	'maxSessionMemory',
	'maxHeaderListPairs',
	'maxOutstandingPings',
	'maxReservedRemoteStreams',
	'maxSendHeaderBlockLength',
	'paddingStrategy',

	// `tls.connect()` options
	'localAddress',
	'path',
	'rejectUnauthorized',
	'minDHSize',

	// `tls.createSecureContext()` options
	'ca',
	'cert',
	'clientCertEngine',
	'ciphers',
	'key',
	'pfx',
	'servername',
	'minVersion',
	'maxVersion',
	'secureProtocol',
	'crl',
	'honorCipherOrder',
	'ecdhCurve',
	'dhparam',
	'secureOptions',
	'sessionIdContext'
];

const getSortedIndex = (array, value, compare) => {
	let low = 0;
	let high = array.length;

	while (low < high) {
		const mid = (low + high) >>> 1;

		/* istanbul ignore next */
		if (compare(array[mid], value)) {
			// This never gets called because we use descending sort. Better to have this anyway.
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	return low;
};

const compareSessions = (a, b) => {
	return a.remoteSettings.maxConcurrentStreams > b.remoteSettings.maxConcurrentStreams;
};

// See https://tools.ietf.org/html/rfc8336
const closeCoveredSessions = (where, session) => {
	// Clients SHOULD NOT emit new requests on any connection whose Origin
	// Set is a proper subset of another connection's Origin Set, and they
	// SHOULD close it once all outstanding requests are satisfied.
	for (const coveredSession of where) {
		if (
			// The set is a proper subset when its length is less than the other set.
			coveredSession[kOriginSet].length < session[kOriginSet].length &&

			// And the other set includes all elements of the subset.
			coveredSession[kOriginSet].every(origin => session[kOriginSet].includes(origin)) &&

			// Makes sure that the session can handle all requests from the covered session.
			coveredSession[kCurrentStreamsCount] + session[kCurrentStreamsCount] <= session.remoteSettings.maxConcurrentStreams
		) {
			// This allows pending requests to finish and prevents making new requests.
			gracefullyClose(coveredSession);
		}
	}
};

// This is basically inverted `closeCoveredSessions(...)`.
const closeSessionIfCovered = (where, coveredSession) => {
	for (const session of where) {
		if (
			coveredSession[kOriginSet].length < session[kOriginSet].length &&
			coveredSession[kOriginSet].every(origin => session[kOriginSet].includes(origin)) &&
			coveredSession[kCurrentStreamsCount] + session[kCurrentStreamsCount] <= session.remoteSettings.maxConcurrentStreams
		) {
			gracefullyClose(coveredSession);
		}
	}
};

const getSessions = ({agent, isFree}) => {
	const result = {};

	// eslint-disable-next-line guard-for-in
	for (const normalizedOptions in agent.sessions) {
		const sessions = agent.sessions[normalizedOptions];

		const filtered = sessions.filter(session => {
			const result = session[Agent.kCurrentStreamsCount] < session.remoteSettings.maxConcurrentStreams;

			return isFree ? result : !result;
		});

		if (filtered.length !== 0) {
			result[normalizedOptions] = filtered;
		}
	}

	return result;
};

const gracefullyClose = session => {
	session[kGracefullyClosing] = true;

	if (session[kCurrentStreamsCount] === 0) {
		session.close();
	}
};

class Agent extends EventEmitter {
	constructor({timeout = 60000, maxSessions = Infinity, maxFreeSessions = 10, maxCachedTlsSessions = 100} = {}) {
		super();

		// A session is considered busy when its current streams count
		// is equal to or greater than the `maxConcurrentStreams` value.

		// A session is considered free when its current streams count
		// is less than the `maxConcurrentStreams` value.

		// SESSIONS[NORMALIZED_OPTIONS] = [];
		this.sessions = {};

		// The queue for creating new sessions. It looks like this:
		// QUEUE[NORMALIZED_OPTIONS][NORMALIZED_ORIGIN] = ENTRY_FUNCTION
		//
		// The entry function has `listeners`, `completed` and `destroyed` properties.
		// `listeners` is an array of objects containing `resolve` and `reject` functions.
		// `completed` is a boolean. It's set to true after ENTRY_FUNCTION is executed.
		// `destroyed` is a boolean. If it's set to true, the session will be destroyed if hasn't connected yet.
		this.queue = {};

		// Each session will use this timeout value.
		this.timeout = timeout;

		// Max sessions in total
		this.maxSessions = maxSessions;

		// Max free sessions in total
		// TODO: decreasing `maxFreeSessions` should close some sessions
		this.maxFreeSessions = maxFreeSessions;

		this._freeSessionsCount = 0;
		this._sessionsCount = 0;

		// We don't support push streams by default.
		this.settings = {
			enablePush: false
		};

		// Reusing TLS sessions increases performance.
		this.tlsSessionCache = new QuickLRU({maxSize: maxCachedTlsSessions});
	}

	static normalizeOrigin(url, servername) {
		if (typeof url === 'string') {
			url = new URL(url);
		}

		if (servername && url.hostname !== servername) {
			url.hostname = servername;
		}

		return url.origin;
	}

	normalizeOptions(options) {
		let normalized = '';

		if (options) {
			for (const key of nameKeys) {
				if (options[key]) {
					normalized += `:${options[key]}`;
				}
			}
		}

		return normalized;
	}

	_tryToCreateNewSession(normalizedOptions, normalizedOrigin) {
		if (!(normalizedOptions in this.queue) || !(normalizedOrigin in this.queue[normalizedOptions])) {
			return;
		}

		const item = this.queue[normalizedOptions][normalizedOrigin];

		// The entry function can be run only once.
		// BUG: The session may be never created when:
		// - the first condition is false AND
		// - this function is never called with the same arguments in the future.
		if (this._sessionsCount < this.maxSessions && !item.completed) {
			item.completed = true;

			item();
		}
	}

	getSession(origin, options, listeners) {
		return new Promise((resolve, reject) => {
			if (Array.isArray(listeners)) {
				listeners = [...listeners];

				// Resolve the current promise ASAP, we're just moving the listeners.
				// They will be executed at a different time.
				resolve();
			} else {
				listeners = [{resolve, reject}];
			}

			const normalizedOptions = this.normalizeOptions(options);
			const normalizedOrigin = Agent.normalizeOrigin(origin, options && options.servername);

			if (normalizedOrigin === undefined) {
				for (const {reject} of listeners) {
					reject(new TypeError('The `origin` argument needs to be a string or an URL object'));
				}

				return;
			}

			if (normalizedOptions in this.sessions) {
				const sessions = this.sessions[normalizedOptions];

				let maxConcurrentStreams = -1;
				let currentStreamsCount = -1;
				let optimalSession;

				// We could just do this.sessions[normalizedOptions].find(...) but that isn't optimal.
				// Additionally, we are looking for session which has biggest current pending streams count.
				for (const session of sessions) {
					const sessionMaxConcurrentStreams = session.remoteSettings.maxConcurrentStreams;

					if (sessionMaxConcurrentStreams < maxConcurrentStreams) {
						break;
					}

					if (session[kOriginSet].includes(normalizedOrigin)) {
						const sessionCurrentStreamsCount = session[kCurrentStreamsCount];

						if (
							sessionCurrentStreamsCount >= sessionMaxConcurrentStreams ||
							session[kGracefullyClosing] ||
							// Unfortunately the `close` event isn't called immediately,
							// so `session.destroyed` is `true`, but `session.closed` is `false`.
							session.destroyed
						) {
							continue;
						}

						// We only need set this once.
						if (!optimalSession) {
							maxConcurrentStreams = sessionMaxConcurrentStreams;
						}

						// We're looking for the session which has biggest current pending stream count,
						// in order to minimalize the amount of active sessions.
						if (sessionCurrentStreamsCount > currentStreamsCount) {
							optimalSession = session;
							currentStreamsCount = sessionCurrentStreamsCount;
						}
					}
				}

				if (optimalSession) {
					/* istanbul ignore next: safety check */
					if (listeners.length !== 1) {
						for (const {reject} of listeners) {
							const error = new Error(
								`Expected the length of listeners to be 1, got ${listeners.length}.\n` +
								'Please report this to https://github.com/szmarczak/http2-wrapper/'
							);

							reject(error);
						}

						return;
					}

					listeners[0].resolve(optimalSession);
					return;
				}
			}

			if (normalizedOptions in this.queue) {
				if (normalizedOrigin in this.queue[normalizedOptions]) {
					// There's already an item in the queue, just attach ourselves to it.
					this.queue[normalizedOptions][normalizedOrigin].listeners.push(...listeners);

					// This shouldn't be executed here.
					// See the comment inside _tryToCreateNewSession.
					this._tryToCreateNewSession(normalizedOptions, normalizedOrigin);
					return;
				}
			} else {
				this.queue[normalizedOptions] = {};
			}

			// The entry must be removed from the queue IMMEDIATELY when:
			// 1. the session connects successfully,
			// 2. an error occurs.
			const removeFromQueue = () => {
				// Our entry can be replaced. We cannot remove the new one.
				if (normalizedOptions in this.queue && this.queue[normalizedOptions][normalizedOrigin] === entry) {
					delete this.queue[normalizedOptions][normalizedOrigin];

					if (Object.keys(this.queue[normalizedOptions]).length === 0) {
						delete this.queue[normalizedOptions];
					}
				}
			};

			// The main logic is here
			const entry = () => {
				const name = `${normalizedOrigin}:${normalizedOptions}`;
				let receivedSettings = false;

				try {
					const session = http2.connect(origin, {
						createConnection: this.createConnection,
						settings: this.settings,
						session: this.tlsSessionCache.get(name),
						...options
					});
					session[kCurrentStreamsCount] = 0;
					session[kGracefullyClosing] = false;

					const isFree = () => session[kCurrentStreamsCount] < session.remoteSettings.maxConcurrentStreams;
					let wasFree = true;

					session.socket.once('session', tlsSession => {
						this.tlsSessionCache.set(name, tlsSession);
					});

					session.once('error', error => {
						// Listeners are empty when the session successfully connected.
						for (const {reject} of listeners) {
							reject(error);
						}

						// The connection got broken, purge the cache.
						this.tlsSessionCache.delete(name);
					});

					session.setTimeout(this.timeout, () => {
						// Terminates all streams owned by this session.
						// TODO: Maybe the streams should have a "Session timed out" error?
						session.destroy();
					});

					session.once('close', () => {
						if (receivedSettings) {
							// 1. If it wasn't free then no need to decrease because
							//    it has been decreased already in session.request().
							// 2. `stream.once('close')` won't increment the count
							//    because the session is already closed.
							if (wasFree) {
								this._freeSessionsCount--;
							}

							this._sessionsCount--;

							// This cannot be moved to the stream logic,
							// because there may be a session that hadn't made a single request.
							const where = this.sessions[normalizedOptions];
							where.splice(where.indexOf(session), 1);

							if (where.length === 0) {
								delete this.sessions[normalizedOptions];
							}
						} else {
							// Broken connection
							const error = new Error('Session closed without receiving a SETTINGS frame');
							error.code = 'HTTP2WRAPPER_NOSETTINGS';

							for (const {reject} of listeners) {
								reject(error);
							}

							removeFromQueue();
						}

						// There may be another session awaiting.
						this._tryToCreateNewSession(normalizedOptions, normalizedOrigin);
					});

					// Iterates over the queue and processes listeners.
					const processListeners = () => {
						if (!(normalizedOptions in this.queue) || !isFree()) {
							return;
						}

						for (const origin of session[kOriginSet]) {
							if (origin in this.queue[normalizedOptions]) {
								const {listeners} = this.queue[normalizedOptions][origin];

								// Prevents session overloading.
								while (listeners.length !== 0 && isFree()) {
									// We assume `resolve(...)` calls `request(...)` *directly*,
									// otherwise the session will get overloaded.
									listeners.shift().resolve(session);
								}

								const where = this.queue[normalizedOptions];
								if (where[origin].listeners.length === 0) {
									delete where[origin];

									if (Object.keys(where).length === 0) {
										delete this.queue[normalizedOptions];
										break;
									}
								}

								// We're no longer free, no point in continuing.
								if (!isFree()) {
									break;
								}
							}
						}
					};

					// The Origin Set cannot shrink. No need to check if it suddenly became covered by another one.
					session.on('origin', () => {
						session[kOriginSet] = session.originSet;

						if (!isFree()) {
							// The session is full.
							return;
						}

						processListeners();

						// Close covered sessions (if possible).
						closeCoveredSessions(this.sessions[normalizedOptions], session);
					});

					session.once('remoteSettings', () => {
						// Fix Node.js bug preventing the process from exiting
						session.ref();
						session.unref();

						this._sessionsCount++;

						// The Agent could have been destroyed already.
						if (entry.destroyed) {
							const error = new Error('Agent has been destroyed');

							for (const listener of listeners) {
								listener.reject(error);
							}

							session.destroy();
							return;
						}

						session[kOriginSet] = session.originSet;

						{
							const where = this.sessions;

							if (normalizedOptions in where) {
								const sessions = where[normalizedOptions];
								sessions.splice(getSortedIndex(sessions, session, compareSessions), 0, session);
							} else {
								where[normalizedOptions] = [session];
							}
						}

						this._freeSessionsCount += 1;
						receivedSettings = true;

						this.emit('session', session);

						processListeners();
						removeFromQueue();

						// TODO: Close last recently used (or least used?) session
						if (session[kCurrentStreamsCount] === 0 && this._freeSessionsCount > this.maxFreeSessions) {
							session.close();
						}

						// Check if we haven't managed to execute all listeners.
						if (listeners.length !== 0) {
							// Request for a new session with predefined listeners.
							this.getSession(normalizedOrigin, options, listeners);
							listeners.length = 0;
						}

						// `session.remoteSettings.maxConcurrentStreams` might get increased
						session.on('remoteSettings', () => {
							processListeners();

							// In case the Origin Set changes
							closeCoveredSessions(this.sessions[normalizedOptions], session);
						});
					});

					// Shim `session.request()` in order to catch all streams
					session[kRequest] = session.request;
					session.request = (headers, streamOptions) => {
						if (session[kGracefullyClosing]) {
							throw new Error('The session is gracefully closing. No new streams are allowed.');
						}

						const stream = session[kRequest](headers, streamOptions);

						// The process won't exit until the session is closed or all requests are gone.
						session.ref();

						++session[kCurrentStreamsCount];

						if (session[kCurrentStreamsCount] === session.remoteSettings.maxConcurrentStreams) {
							this._freeSessionsCount--;
						}

						stream.once('close', () => {
							wasFree = isFree();

							--session[kCurrentStreamsCount];

							if (!session.destroyed && !session.closed) {
								closeSessionIfCovered(this.sessions[normalizedOptions], session);

								if (isFree() && !session.closed) {
									if (!wasFree) {
										this._freeSessionsCount++;

										wasFree = true;
									}

									const isEmpty = session[kCurrentStreamsCount] === 0;

									if (isEmpty) {
										session.unref();
									}

									if (
										isEmpty &&
										(
											this._freeSessionsCount > this.maxFreeSessions ||
											session[kGracefullyClosing]
										)
									) {
										session.close();
									} else {
										closeCoveredSessions(this.sessions[normalizedOptions], session);
										processListeners();
									}
								}
							}
						});

						return stream;
					};
				} catch (error) {
					for (const listener of listeners) {
						listener.reject(error);
					}

					removeFromQueue();
				}
			};

			entry.listeners = listeners;
			entry.completed = false;
			entry.destroyed = false;

			this.queue[normalizedOptions][normalizedOrigin] = entry;
			this._tryToCreateNewSession(normalizedOptions, normalizedOrigin);
		});
	}

	request(origin, options, headers, streamOptions) {
		return new Promise((resolve, reject) => {
			this.getSession(origin, options, [{
				reject,
				resolve: session => {
					try {
						resolve(session.request(headers, streamOptions));
					} catch (error) {
						reject(error);
					}
				}
			}]);
		});
	}

	createConnection(origin, options) {
		return Agent.connect(origin, options);
	}

	static connect(origin, options) {
		options.ALPNProtocols = ['h2'];

		const port = origin.port || 443;
		const host = origin.hostname || origin.host;

		if (typeof options.servername === 'undefined') {
			options.servername = host;
		}

		return tls.connect(port, host, options);
	}

	closeFreeSessions() {
		for (const sessions of Object.values(this.sessions)) {
			for (const session of sessions) {
				if (session[kCurrentStreamsCount] === 0) {
					session.close();
				}
			}
		}
	}

	destroy(reason) {
		for (const sessions of Object.values(this.sessions)) {
			for (const session of sessions) {
				session.destroy(reason);
			}
		}

		for (const entriesOfAuthority of Object.values(this.queue)) {
			for (const entry of Object.values(entriesOfAuthority)) {
				entry.destroyed = true;
			}
		}

		// New requests should NOT attach to destroyed sessions
		this.queue = {};
	}

	get freeSessions() {
		return getSessions({agent: this, isFree: true});
	}

	get busySessions() {
		return getSessions({agent: this, isFree: false});
	}
}

Agent.kCurrentStreamsCount = kCurrentStreamsCount;
Agent.kGracefullyClosing = kGracefullyClosing;

module.exports = {
	Agent,
	globalAgent: new Agent()
};


/***/ }),

/***/ 909:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
/* istanbul ignore file: deprecated */
const url_1 = __webpack_require__(835);
const keys = [
    'protocol',
    'host',
    'hostname',
    'port',
    'pathname',
    'search'
];
exports.default = (origin, options) => {
    var _a, _b;
    if (options.path) {
        if (options.pathname) {
            throw new TypeError('Parameters `path` and `pathname` are mutually exclusive.');
        }
        if (options.search) {
            throw new TypeError('Parameters `path` and `search` are mutually exclusive.');
        }
        if (options.searchParams) {
            throw new TypeError('Parameters `path` and `searchParams` are mutually exclusive.');
        }
    }
    if (options.search && options.searchParams) {
        throw new TypeError('Parameters `search` and `searchParams` are mutually exclusive.');
    }
    if (!origin) {
        if (!options.protocol) {
            throw new TypeError('No URL protocol specified');
        }
        origin = `${options.protocol}//${(_b = (_a = options.hostname) !== null && _a !== void 0 ? _a : options.host) !== null && _b !== void 0 ? _b : ''}`;
    }
    const url = new url_1.URL(origin);
    if (options.path) {
        const searchIndex = options.path.indexOf('?');
        if (searchIndex === -1) {
            options.pathname = options.path;
        }
        else {
            options.pathname = options.path.slice(0, searchIndex);
            options.search = options.path.slice(searchIndex + 1);
        }
        delete options.path;
    }
    for (const key of keys) {
        if (options[key]) {
            url[key] = options[key].toString();
        }
    }
    return url;
};


/***/ }),

/***/ 914:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiBaseUrl = exports.getProxyAgent = exports.getAuthString = void 0;
const httpClient = __importStar(__webpack_require__(925));
function getAuthString(token, options) {
    if (!token && !options.auth) {
        throw new Error('Parameter token or opts.auth is required');
    }
    else if (token && options.auth) {
        throw new Error('Parameters token and opts.auth may not both be specified');
    }
    return typeof options.auth === 'string' ? options.auth : `token ${token}`;
}
exports.getAuthString = getAuthString;
function getProxyAgent(destinationUrl) {
    const hc = new httpClient.HttpClient();
    return hc.getAgent(destinationUrl);
}
exports.getProxyAgent = getProxyAgent;
function getApiBaseUrl() {
    return process.env['GITHUB_API_URL'] || 'https://api.github.com';
}
exports.getApiBaseUrl = getApiBaseUrl;
//# sourceMappingURL=utils.js.map

/***/ }),

/***/ 925:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const http = __webpack_require__(605);
const https = __webpack_require__(211);
const pm = __webpack_require__(443);
let tunnel;
var HttpCodes;
(function (HttpCodes) {
    HttpCodes[HttpCodes["OK"] = 200] = "OK";
    HttpCodes[HttpCodes["MultipleChoices"] = 300] = "MultipleChoices";
    HttpCodes[HttpCodes["MovedPermanently"] = 301] = "MovedPermanently";
    HttpCodes[HttpCodes["ResourceMoved"] = 302] = "ResourceMoved";
    HttpCodes[HttpCodes["SeeOther"] = 303] = "SeeOther";
    HttpCodes[HttpCodes["NotModified"] = 304] = "NotModified";
    HttpCodes[HttpCodes["UseProxy"] = 305] = "UseProxy";
    HttpCodes[HttpCodes["SwitchProxy"] = 306] = "SwitchProxy";
    HttpCodes[HttpCodes["TemporaryRedirect"] = 307] = "TemporaryRedirect";
    HttpCodes[HttpCodes["PermanentRedirect"] = 308] = "PermanentRedirect";
    HttpCodes[HttpCodes["BadRequest"] = 400] = "BadRequest";
    HttpCodes[HttpCodes["Unauthorized"] = 401] = "Unauthorized";
    HttpCodes[HttpCodes["PaymentRequired"] = 402] = "PaymentRequired";
    HttpCodes[HttpCodes["Forbidden"] = 403] = "Forbidden";
    HttpCodes[HttpCodes["NotFound"] = 404] = "NotFound";
    HttpCodes[HttpCodes["MethodNotAllowed"] = 405] = "MethodNotAllowed";
    HttpCodes[HttpCodes["NotAcceptable"] = 406] = "NotAcceptable";
    HttpCodes[HttpCodes["ProxyAuthenticationRequired"] = 407] = "ProxyAuthenticationRequired";
    HttpCodes[HttpCodes["RequestTimeout"] = 408] = "RequestTimeout";
    HttpCodes[HttpCodes["Conflict"] = 409] = "Conflict";
    HttpCodes[HttpCodes["Gone"] = 410] = "Gone";
    HttpCodes[HttpCodes["TooManyRequests"] = 429] = "TooManyRequests";
    HttpCodes[HttpCodes["InternalServerError"] = 500] = "InternalServerError";
    HttpCodes[HttpCodes["NotImplemented"] = 501] = "NotImplemented";
    HttpCodes[HttpCodes["BadGateway"] = 502] = "BadGateway";
    HttpCodes[HttpCodes["ServiceUnavailable"] = 503] = "ServiceUnavailable";
    HttpCodes[HttpCodes["GatewayTimeout"] = 504] = "GatewayTimeout";
})(HttpCodes = exports.HttpCodes || (exports.HttpCodes = {}));
var Headers;
(function (Headers) {
    Headers["Accept"] = "accept";
    Headers["ContentType"] = "content-type";
})(Headers = exports.Headers || (exports.Headers = {}));
var MediaTypes;
(function (MediaTypes) {
    MediaTypes["ApplicationJson"] = "application/json";
})(MediaTypes = exports.MediaTypes || (exports.MediaTypes = {}));
/**
 * Returns the proxy URL, depending upon the supplied url and proxy environment variables.
 * @param serverUrl  The server URL where the request will be sent. For example, https://api.github.com
 */
function getProxyUrl(serverUrl) {
    let proxyUrl = pm.getProxyUrl(new URL(serverUrl));
    return proxyUrl ? proxyUrl.href : '';
}
exports.getProxyUrl = getProxyUrl;
const HttpRedirectCodes = [
    HttpCodes.MovedPermanently,
    HttpCodes.ResourceMoved,
    HttpCodes.SeeOther,
    HttpCodes.TemporaryRedirect,
    HttpCodes.PermanentRedirect
];
const HttpResponseRetryCodes = [
    HttpCodes.BadGateway,
    HttpCodes.ServiceUnavailable,
    HttpCodes.GatewayTimeout
];
const RetryableHttpVerbs = ['OPTIONS', 'GET', 'DELETE', 'HEAD'];
const ExponentialBackoffCeiling = 10;
const ExponentialBackoffTimeSlice = 5;
class HttpClientError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = 'HttpClientError';
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, HttpClientError.prototype);
    }
}
exports.HttpClientError = HttpClientError;
class HttpClientResponse {
    constructor(message) {
        this.message = message;
    }
    readBody() {
        return new Promise(async (resolve, reject) => {
            let output = Buffer.alloc(0);
            this.message.on('data', (chunk) => {
                output = Buffer.concat([output, chunk]);
            });
            this.message.on('end', () => {
                resolve(output.toString());
            });
        });
    }
}
exports.HttpClientResponse = HttpClientResponse;
function isHttps(requestUrl) {
    let parsedUrl = new URL(requestUrl);
    return parsedUrl.protocol === 'https:';
}
exports.isHttps = isHttps;
class HttpClient {
    constructor(userAgent, handlers, requestOptions) {
        this._ignoreSslError = false;
        this._allowRedirects = true;
        this._allowRedirectDowngrade = false;
        this._maxRedirects = 50;
        this._allowRetries = false;
        this._maxRetries = 1;
        this._keepAlive = false;
        this._disposed = false;
        this.userAgent = userAgent;
        this.handlers = handlers || [];
        this.requestOptions = requestOptions;
        if (requestOptions) {
            if (requestOptions.ignoreSslError != null) {
                this._ignoreSslError = requestOptions.ignoreSslError;
            }
            this._socketTimeout = requestOptions.socketTimeout;
            if (requestOptions.allowRedirects != null) {
                this._allowRedirects = requestOptions.allowRedirects;
            }
            if (requestOptions.allowRedirectDowngrade != null) {
                this._allowRedirectDowngrade = requestOptions.allowRedirectDowngrade;
            }
            if (requestOptions.maxRedirects != null) {
                this._maxRedirects = Math.max(requestOptions.maxRedirects, 0);
            }
            if (requestOptions.keepAlive != null) {
                this._keepAlive = requestOptions.keepAlive;
            }
            if (requestOptions.allowRetries != null) {
                this._allowRetries = requestOptions.allowRetries;
            }
            if (requestOptions.maxRetries != null) {
                this._maxRetries = requestOptions.maxRetries;
            }
        }
    }
    options(requestUrl, additionalHeaders) {
        return this.request('OPTIONS', requestUrl, null, additionalHeaders || {});
    }
    get(requestUrl, additionalHeaders) {
        return this.request('GET', requestUrl, null, additionalHeaders || {});
    }
    del(requestUrl, additionalHeaders) {
        return this.request('DELETE', requestUrl, null, additionalHeaders || {});
    }
    post(requestUrl, data, additionalHeaders) {
        return this.request('POST', requestUrl, data, additionalHeaders || {});
    }
    patch(requestUrl, data, additionalHeaders) {
        return this.request('PATCH', requestUrl, data, additionalHeaders || {});
    }
    put(requestUrl, data, additionalHeaders) {
        return this.request('PUT', requestUrl, data, additionalHeaders || {});
    }
    head(requestUrl, additionalHeaders) {
        return this.request('HEAD', requestUrl, null, additionalHeaders || {});
    }
    sendStream(verb, requestUrl, stream, additionalHeaders) {
        return this.request(verb, requestUrl, stream, additionalHeaders);
    }
    /**
     * Gets a typed object from an endpoint
     * Be aware that not found returns a null.  Other errors (4xx, 5xx) reject the promise
     */
    async getJson(requestUrl, additionalHeaders = {}) {
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        let res = await this.get(requestUrl, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    async postJson(requestUrl, obj, additionalHeaders = {}) {
        let data = JSON.stringify(obj, null, 2);
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        additionalHeaders[Headers.ContentType] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.ContentType, MediaTypes.ApplicationJson);
        let res = await this.post(requestUrl, data, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    async putJson(requestUrl, obj, additionalHeaders = {}) {
        let data = JSON.stringify(obj, null, 2);
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        additionalHeaders[Headers.ContentType] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.ContentType, MediaTypes.ApplicationJson);
        let res = await this.put(requestUrl, data, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    async patchJson(requestUrl, obj, additionalHeaders = {}) {
        let data = JSON.stringify(obj, null, 2);
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        additionalHeaders[Headers.ContentType] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.ContentType, MediaTypes.ApplicationJson);
        let res = await this.patch(requestUrl, data, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    /**
     * Makes a raw http request.
     * All other methods such as get, post, patch, and request ultimately call this.
     * Prefer get, del, post and patch
     */
    async request(verb, requestUrl, data, headers) {
        if (this._disposed) {
            throw new Error('Client has already been disposed.');
        }
        let parsedUrl = new URL(requestUrl);
        let info = this._prepareRequest(verb, parsedUrl, headers);
        // Only perform retries on reads since writes may not be idempotent.
        let maxTries = this._allowRetries && RetryableHttpVerbs.indexOf(verb) != -1
            ? this._maxRetries + 1
            : 1;
        let numTries = 0;
        let response;
        while (numTries < maxTries) {
            response = await this.requestRaw(info, data);
            // Check if it's an authentication challenge
            if (response &&
                response.message &&
                response.message.statusCode === HttpCodes.Unauthorized) {
                let authenticationHandler;
                for (let i = 0; i < this.handlers.length; i++) {
                    if (this.handlers[i].canHandleAuthentication(response)) {
                        authenticationHandler = this.handlers[i];
                        break;
                    }
                }
                if (authenticationHandler) {
                    return authenticationHandler.handleAuthentication(this, info, data);
                }
                else {
                    // We have received an unauthorized response but have no handlers to handle it.
                    // Let the response return to the caller.
                    return response;
                }
            }
            let redirectsRemaining = this._maxRedirects;
            while (HttpRedirectCodes.indexOf(response.message.statusCode) != -1 &&
                this._allowRedirects &&
                redirectsRemaining > 0) {
                const redirectUrl = response.message.headers['location'];
                if (!redirectUrl) {
                    // if there's no location to redirect to, we won't
                    break;
                }
                let parsedRedirectUrl = new URL(redirectUrl);
                if (parsedUrl.protocol == 'https:' &&
                    parsedUrl.protocol != parsedRedirectUrl.protocol &&
                    !this._allowRedirectDowngrade) {
                    throw new Error('Redirect from HTTPS to HTTP protocol. This downgrade is not allowed for security reasons. If you want to allow this behavior, set the allowRedirectDowngrade option to true.');
                }
                // we need to finish reading the response before reassigning response
                // which will leak the open socket.
                await response.readBody();
                // strip authorization header if redirected to a different hostname
                if (parsedRedirectUrl.hostname !== parsedUrl.hostname) {
                    for (let header in headers) {
                        // header names are case insensitive
                        if (header.toLowerCase() === 'authorization') {
                            delete headers[header];
                        }
                    }
                }
                // let's make the request with the new redirectUrl
                info = this._prepareRequest(verb, parsedRedirectUrl, headers);
                response = await this.requestRaw(info, data);
                redirectsRemaining--;
            }
            if (HttpResponseRetryCodes.indexOf(response.message.statusCode) == -1) {
                // If not a retry code, return immediately instead of retrying
                return response;
            }
            numTries += 1;
            if (numTries < maxTries) {
                await response.readBody();
                await this._performExponentialBackoff(numTries);
            }
        }
        return response;
    }
    /**
     * Needs to be called if keepAlive is set to true in request options.
     */
    dispose() {
        if (this._agent) {
            this._agent.destroy();
        }
        this._disposed = true;
    }
    /**
     * Raw request.
     * @param info
     * @param data
     */
    requestRaw(info, data) {
        return new Promise((resolve, reject) => {
            let callbackForResult = function (err, res) {
                if (err) {
                    reject(err);
                }
                resolve(res);
            };
            this.requestRawWithCallback(info, data, callbackForResult);
        });
    }
    /**
     * Raw request with callback.
     * @param info
     * @param data
     * @param onResult
     */
    requestRawWithCallback(info, data, onResult) {
        let socket;
        if (typeof data === 'string') {
            info.options.headers['Content-Length'] = Buffer.byteLength(data, 'utf8');
        }
        let callbackCalled = false;
        let handleResult = (err, res) => {
            if (!callbackCalled) {
                callbackCalled = true;
                onResult(err, res);
            }
        };
        let req = info.httpModule.request(info.options, (msg) => {
            let res = new HttpClientResponse(msg);
            handleResult(null, res);
        });
        req.on('socket', sock => {
            socket = sock;
        });
        // If we ever get disconnected, we want the socket to timeout eventually
        req.setTimeout(this._socketTimeout || 3 * 60000, () => {
            if (socket) {
                socket.end();
            }
            handleResult(new Error('Request timeout: ' + info.options.path), null);
        });
        req.on('error', function (err) {
            // err has statusCode property
            // res should have headers
            handleResult(err, null);
        });
        if (data && typeof data === 'string') {
            req.write(data, 'utf8');
        }
        if (data && typeof data !== 'string') {
            data.on('close', function () {
                req.end();
            });
            data.pipe(req);
        }
        else {
            req.end();
        }
    }
    /**
     * Gets an http agent. This function is useful when you need an http agent that handles
     * routing through a proxy server - depending upon the url and proxy environment variables.
     * @param serverUrl  The server URL where the request will be sent. For example, https://api.github.com
     */
    getAgent(serverUrl) {
        let parsedUrl = new URL(serverUrl);
        return this._getAgent(parsedUrl);
    }
    _prepareRequest(method, requestUrl, headers) {
        const info = {};
        info.parsedUrl = requestUrl;
        const usingSsl = info.parsedUrl.protocol === 'https:';
        info.httpModule = usingSsl ? https : http;
        const defaultPort = usingSsl ? 443 : 80;
        info.options = {};
        info.options.host = info.parsedUrl.hostname;
        info.options.port = info.parsedUrl.port
            ? parseInt(info.parsedUrl.port)
            : defaultPort;
        info.options.path =
            (info.parsedUrl.pathname || '') + (info.parsedUrl.search || '');
        info.options.method = method;
        info.options.headers = this._mergeHeaders(headers);
        if (this.userAgent != null) {
            info.options.headers['user-agent'] = this.userAgent;
        }
        info.options.agent = this._getAgent(info.parsedUrl);
        // gives handlers an opportunity to participate
        if (this.handlers) {
            this.handlers.forEach(handler => {
                handler.prepareRequest(info.options);
            });
        }
        return info;
    }
    _mergeHeaders(headers) {
        const lowercaseKeys = obj => Object.keys(obj).reduce((c, k) => ((c[k.toLowerCase()] = obj[k]), c), {});
        if (this.requestOptions && this.requestOptions.headers) {
            return Object.assign({}, lowercaseKeys(this.requestOptions.headers), lowercaseKeys(headers));
        }
        return lowercaseKeys(headers || {});
    }
    _getExistingOrDefaultHeader(additionalHeaders, header, _default) {
        const lowercaseKeys = obj => Object.keys(obj).reduce((c, k) => ((c[k.toLowerCase()] = obj[k]), c), {});
        let clientHeader;
        if (this.requestOptions && this.requestOptions.headers) {
            clientHeader = lowercaseKeys(this.requestOptions.headers)[header];
        }
        return additionalHeaders[header] || clientHeader || _default;
    }
    _getAgent(parsedUrl) {
        let agent;
        let proxyUrl = pm.getProxyUrl(parsedUrl);
        let useProxy = proxyUrl && proxyUrl.hostname;
        if (this._keepAlive && useProxy) {
            agent = this._proxyAgent;
        }
        if (this._keepAlive && !useProxy) {
            agent = this._agent;
        }
        // if agent is already assigned use that agent.
        if (!!agent) {
            return agent;
        }
        const usingSsl = parsedUrl.protocol === 'https:';
        let maxSockets = 100;
        if (!!this.requestOptions) {
            maxSockets = this.requestOptions.maxSockets || http.globalAgent.maxSockets;
        }
        if (useProxy) {
            // If using proxy, need tunnel
            if (!tunnel) {
                tunnel = __webpack_require__(294);
            }
            const agentOptions = {
                maxSockets: maxSockets,
                keepAlive: this._keepAlive,
                proxy: {
                    proxyAuth: `${proxyUrl.username}:${proxyUrl.password}`,
                    host: proxyUrl.hostname,
                    port: proxyUrl.port
                }
            };
            let tunnelAgent;
            const overHttps = proxyUrl.protocol === 'https:';
            if (usingSsl) {
                tunnelAgent = overHttps ? tunnel.httpsOverHttps : tunnel.httpsOverHttp;
            }
            else {
                tunnelAgent = overHttps ? tunnel.httpOverHttps : tunnel.httpOverHttp;
            }
            agent = tunnelAgent(agentOptions);
            this._proxyAgent = agent;
        }
        // if reusing agent across request and tunneling agent isn't assigned create a new agent
        if (this._keepAlive && !agent) {
            const options = { keepAlive: this._keepAlive, maxSockets: maxSockets };
            agent = usingSsl ? new https.Agent(options) : new http.Agent(options);
            this._agent = agent;
        }
        // if not using private agent and tunnel agent isn't setup then use global agent
        if (!agent) {
            agent = usingSsl ? https.globalAgent : http.globalAgent;
        }
        if (usingSsl && this._ignoreSslError) {
            // we don't want to set NODE_TLS_REJECT_UNAUTHORIZED=0 since that will affect request for entire process
            // http.RequestOptions doesn't expose a way to modify RequestOptions.agent.options
            // we have to cast it to any and change it directly
            agent.options = Object.assign(agent.options || {}, {
                rejectUnauthorized: false
            });
        }
        return agent;
    }
    _performExponentialBackoff(retryNumber) {
        retryNumber = Math.min(ExponentialBackoffCeiling, retryNumber);
        const ms = ExponentialBackoffTimeSlice * Math.pow(2, retryNumber);
        return new Promise(resolve => setTimeout(() => resolve(), ms));
    }
    static dateTimeDeserializer(key, value) {
        if (typeof value === 'string') {
            let a = new Date(value);
            if (!isNaN(a.valueOf())) {
                return a;
            }
        }
        return value;
    }
    async _processResponse(res, options) {
        return new Promise(async (resolve, reject) => {
            const statusCode = res.message.statusCode;
            const response = {
                statusCode: statusCode,
                result: null,
                headers: {}
            };
            // not found leads to null obj returned
            if (statusCode == HttpCodes.NotFound) {
                resolve(response);
            }
            let obj;
            let contents;
            // get the result from the body
            try {
                contents = await res.readBody();
                if (contents && contents.length > 0) {
                    if (options && options.deserializeDates) {
                        obj = JSON.parse(contents, HttpClient.dateTimeDeserializer);
                    }
                    else {
                        obj = JSON.parse(contents);
                    }
                    response.result = obj;
                }
                response.headers = res.message.headers;
            }
            catch (err) {
                // Invalid resource (contents not json);  leaving result obj null
            }
            // note that 3xx redirects are handled by the http layer.
            if (statusCode > 299) {
                let msg;
                // if exception/error in body, attempt to get better error
                if (obj && obj.message) {
                    msg = obj.message;
                }
                else if (contents && contents.length > 0) {
                    // it may be the case that the exception is in the body message as string
                    msg = contents;
                }
                else {
                    msg = 'Failed request: (' + statusCode + ')';
                }
                let err = new HttpClientError(msg, statusCode);
                err.result = response.result;
                reject(err);
            }
            else {
                resolve(response);
            }
        });
    }
}
exports.HttpClient = HttpClient;


/***/ }),

/***/ 932:
/***/ (function(__unusedmodule, exports) {

"use strict";


Object.defineProperty(exports, '__esModule', { value: true });

class Deprecation extends Error {
  constructor(message) {
    super(message); // Maintains proper stack trace (only available on V8)

    /* istanbul ignore next */

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = 'Deprecation';
  }

}

exports.Deprecation = Deprecation;


/***/ }),

/***/ 940:
/***/ (function(module) {

// Returns a wrapper function that returns a wrapped callback
// The wrapper function should do some stuff, and return a
// presumably different callback function.
// This makes sure that own properties are retained, so that
// decorations and such are not lost along the way.
module.exports = wrappy
function wrappy (fn, cb) {
  if (fn && cb) return wrappy(fn)(cb)

  if (typeof fn !== 'function')
    throw new TypeError('need wrapper function')

  Object.keys(fn).forEach(function (k) {
    wrapper[k] = fn[k]
  })

  return wrapper

  function wrapper() {
    var args = new Array(arguments.length)
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i]
    }
    var ret = fn.apply(this, args)
    var cb = args[args.length-1]
    if (typeof ret === 'function' && ret !== cb) {
      Object.keys(cb).forEach(function (k) {
        ret[k] = cb[k]
      })
    }
    return ret
  }
}


/***/ }),

/***/ 950:
/***/ (function(module) {

// This file is generated by `build.js`.
module.exports = {
  cmn: /[\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u3005\u3007\u3021-\u3029\u3038-\u303B\u3400-\u4DB5\u4E00-\u9FEF\uF900-\uFA6D\uFA70-\uFAD9]|[\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872\uD874-\uD879][\uDC00-\uDFFF]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1\uDEB0-\uDFFF]|\uD87A[\uDC00-\uDFE0]|\uD87E[\uDC00-\uDE1D]/g,
  Latin: /[A-Za-z\xAA\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02B8\u02E0-\u02E4\u1D00-\u1D25\u1D2C-\u1D5C\u1D62-\u1D65\u1D6B-\u1D77\u1D79-\u1DBE\u1E00-\u1EFF\u2071\u207F\u2090-\u209C\u212A\u212B\u2132\u214E\u2160-\u2188\u2C60-\u2C7F\uA722-\uA787\uA78B-\uA7BF\uA7C2-\uA7C6\uA7F7-\uA7FF\uAB30-\uAB5A\uAB5C-\uAB64\uAB66\uAB67\uFB00-\uFB06\uFF21-\uFF3A\uFF41-\uFF5A]/g,
  Cyrillic: /[\u0400-\u0484\u0487-\u052F\u1C80-\u1C88\u1D2B\u1D78\u2DE0-\u2DFF\uA640-\uA69F\uFE2E\uFE2F]/g,
  Arabic: /[\u0600-\u0604\u0606-\u060B\u060D-\u061A\u061C\u061E\u0620-\u063F\u0641-\u064A\u0656-\u066F\u0671-\u06DC\u06DE-\u06FF\u0750-\u077F\u08A0-\u08B4\u08B6-\u08BD\u08D3-\u08E1\u08E3-\u08FF\uFB50-\uFBC1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFD\uFE70-\uFE74\uFE76-\uFEFC]|\uD803[\uDE60-\uDE7E]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB\uDEF0\uDEF1]/g,
  ben: /[\u0980-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09FE]/g,
  Devanagari: /[\u0900-\u0950\u0955-\u0963\u0966-\u097F\uA8E0-\uA8FF]/g,
  jpn: /[\u3041-\u3096\u309D-\u309F]|\uD82C[\uDC01-\uDD1E\uDD50-\uDD52]|\uD83C\uDE00|[\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF\u32D0-\u32FE\u3300-\u3357\uFF66-\uFF6F\uFF71-\uFF9D]|\uD82C[\uDC00\uDD64-\uDD67]|[㐀-䶵一-龯]/g,
  kor: /[\u1100-\u11FF\u302E\u302F\u3131-\u318E\u3200-\u321E\u3260-\u327E\uA960-\uA97C\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uFFA0-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/g,
  tel: /[\u0C00-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58-\u0C5A\u0C60-\u0C63\u0C66-\u0C6F\u0C77-\u0C7F]/g,
  tam: /[\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BFA]|\uD807[\uDFC0-\uDFF1\uDFFF]/g,
  guj: /[\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AF1\u0AF9-\u0AFF]/g,
  kan: /[\u0C80-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2]/g,
  mal: /[\u0D00-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D44\u0D46-\u0D48\u0D4A-\u0D4F\u0D54-\u0D63\u0D66-\u0D7F]/g,
  mya: /[\u1000-\u109F\uA9E0-\uA9FE\uAA60-\uAA7F]/g,
  ori: /[\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B77]/g,
  pan: /[\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A76]/g,
  amh: /[\u1200-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u137C\u1380-\u1399\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E]/g,
  tha: /[\u0E01-\u0E3A\u0E40-\u0E5B]/g,
  sin: /[\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2-\u0DF4]|\uD804[\uDDE1-\uDDF4]/g,
  ell: /[\u0370-\u0373\u0375-\u0377\u037A-\u037D\u037F\u0384\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03E1\u03F0-\u03FF\u1D26-\u1D2A\u1D5D-\u1D61\u1D66-\u1D6A\u1DBF\u1F00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FC4\u1FC6-\u1FD3\u1FD6-\u1FDB\u1FDD-\u1FEF\u1FF2-\u1FF4\u1FF6-\u1FFE\u2126\uAB65]|\uD800[\uDD40-\uDD8E\uDDA0]|\uD834[\uDE00-\uDE45]/g
}


/***/ }),

/***/ 952:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

// TODO: Use the `URL` global when targeting Node.js 10
const URLParser = typeof URL === 'undefined' ? __webpack_require__(835).URL : URL;

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
const DATA_URL_DEFAULT_MIME_TYPE = 'text/plain';
const DATA_URL_DEFAULT_CHARSET = 'us-ascii';

const testParameter = (name, filters) => {
	return filters.some(filter => filter instanceof RegExp ? filter.test(name) : filter === name);
};

const normalizeDataURL = (urlString, {stripHash}) => {
	const parts = urlString.match(/^data:(.*?),(.*?)(?:#(.*))?$/);

	if (!parts) {
		throw new Error(`Invalid URL: ${urlString}`);
	}

	const mediaType = parts[1].split(';');
	const body = parts[2];
	const hash = stripHash ? '' : parts[3];

	let base64 = false;

	if (mediaType[mediaType.length - 1] === 'base64') {
		mediaType.pop();
		base64 = true;
	}

	// Lowercase MIME type
	const mimeType = (mediaType.shift() || '').toLowerCase();
	const attributes = mediaType
		.map(attribute => {
			let [key, value = ''] = attribute.split('=').map(string => string.trim());

			// Lowercase `charset`
			if (key === 'charset') {
				value = value.toLowerCase();

				if (value === DATA_URL_DEFAULT_CHARSET) {
					return '';
				}
			}

			return `${key}${value ? `=${value}` : ''}`;
		})
		.filter(Boolean);

	const normalizedMediaType = [
		...attributes
	];

	if (base64) {
		normalizedMediaType.push('base64');
	}

	if (normalizedMediaType.length !== 0 || (mimeType && mimeType !== DATA_URL_DEFAULT_MIME_TYPE)) {
		normalizedMediaType.unshift(mimeType);
	}

	return `data:${normalizedMediaType.join(';')},${base64 ? body.trim() : body}${hash ? `#${hash}` : ''}`;
};

const normalizeUrl = (urlString, options) => {
	options = {
		defaultProtocol: 'http:',
		normalizeProtocol: true,
		forceHttp: false,
		forceHttps: false,
		stripAuthentication: true,
		stripHash: false,
		stripWWW: true,
		removeQueryParameters: [/^utm_\w+/i],
		removeTrailingSlash: true,
		removeDirectoryIndex: false,
		sortQueryParameters: true,
		...options
	};

	// TODO: Remove this at some point in the future
	if (Reflect.has(options, 'normalizeHttps')) {
		throw new Error('options.normalizeHttps is renamed to options.forceHttp');
	}

	if (Reflect.has(options, 'normalizeHttp')) {
		throw new Error('options.normalizeHttp is renamed to options.forceHttps');
	}

	if (Reflect.has(options, 'stripFragment')) {
		throw new Error('options.stripFragment is renamed to options.stripHash');
	}

	urlString = urlString.trim();

	// Data URL
	if (/^data:/i.test(urlString)) {
		return normalizeDataURL(urlString, options);
	}

	const hasRelativeProtocol = urlString.startsWith('//');
	const isRelativeUrl = !hasRelativeProtocol && /^\.*\//.test(urlString);

	// Prepend protocol
	if (!isRelativeUrl) {
		urlString = urlString.replace(/^(?!(?:\w+:)?\/\/)|^\/\//, options.defaultProtocol);
	}

	const urlObj = new URLParser(urlString);

	if (options.forceHttp && options.forceHttps) {
		throw new Error('The `forceHttp` and `forceHttps` options cannot be used together');
	}

	if (options.forceHttp && urlObj.protocol === 'https:') {
		urlObj.protocol = 'http:';
	}

	if (options.forceHttps && urlObj.protocol === 'http:') {
		urlObj.protocol = 'https:';
	}

	// Remove auth
	if (options.stripAuthentication) {
		urlObj.username = '';
		urlObj.password = '';
	}

	// Remove hash
	if (options.stripHash) {
		urlObj.hash = '';
	}

	// Remove duplicate slashes if not preceded by a protocol
	if (urlObj.pathname) {
		// TODO: Use the following instead when targeting Node.js 10
		// `urlObj.pathname = urlObj.pathname.replace(/(?<!https?:)\/{2,}/g, '/');`
		urlObj.pathname = urlObj.pathname.replace(/((?!:).|^)\/{2,}/g, (_, p1) => {
			if (/^(?!\/)/g.test(p1)) {
				return `${p1}/`;
			}

			return '/';
		});
	}

	// Decode URI octets
	if (urlObj.pathname) {
		urlObj.pathname = decodeURI(urlObj.pathname);
	}

	// Remove directory index
	if (options.removeDirectoryIndex === true) {
		options.removeDirectoryIndex = [/^index\.[a-z]+$/];
	}

	if (Array.isArray(options.removeDirectoryIndex) && options.removeDirectoryIndex.length > 0) {
		let pathComponents = urlObj.pathname.split('/');
		const lastComponent = pathComponents[pathComponents.length - 1];

		if (testParameter(lastComponent, options.removeDirectoryIndex)) {
			pathComponents = pathComponents.slice(0, pathComponents.length - 1);
			urlObj.pathname = pathComponents.slice(1).join('/') + '/';
		}
	}

	if (urlObj.hostname) {
		// Remove trailing dot
		urlObj.hostname = urlObj.hostname.replace(/\.$/, '');

		// Remove `www.`
		if (options.stripWWW && /^www\.([a-z\-\d]{2,63})\.([a-z.]{2,5})$/.test(urlObj.hostname)) {
			// Each label should be max 63 at length (min: 2).
			// The extension should be max 5 at length (min: 2).
			// Source: https://en.wikipedia.org/wiki/Hostname#Restrictions_on_valid_host_names
			urlObj.hostname = urlObj.hostname.replace(/^www\./, '');
		}
	}

	// Remove query unwanted parameters
	if (Array.isArray(options.removeQueryParameters)) {
		for (const key of [...urlObj.searchParams.keys()]) {
			if (testParameter(key, options.removeQueryParameters)) {
				urlObj.searchParams.delete(key);
			}
		}
	}

	// Sort query parameters
	if (options.sortQueryParameters) {
		urlObj.searchParams.sort();
	}

	if (options.removeTrailingSlash) {
		urlObj.pathname = urlObj.pathname.replace(/\/$/, '');
	}

	// Take advantage of many of the Node `url` normalizations
	urlString = urlObj.toString();

	// Remove ending `/`
	if ((options.removeTrailingSlash || urlObj.pathname === '/') && urlObj.hash === '') {
		urlString = urlString.replace(/\/$/, '');
	}

	// Restore relative protocol, if applicable
	if (hasRelativeProtocol && !options.normalizeProtocol) {
		urlString = urlString.replace(/^http:\/\//, '//');
	}

	// Remove http/https
	if (options.stripProtocol) {
		urlString = urlString.replace(/^(?:https?:)?\/\//, '');
	}

	return urlString;
};

module.exports = normalizeUrl;
// TODO: Remove this for the next major release
module.exports.default = normalizeUrl;


/***/ }),

/***/ 982:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";

const net = __webpack_require__(631);
/* istanbul ignore file: https://github.com/nodejs/node/blob/v13.0.1/lib/_http_agent.js */

module.exports = options => {
	let servername = options.host;
	const hostHeader = options.headers && options.headers.host;

	if (hostHeader) {
		if (hostHeader.startsWith('[')) {
			const index = hostHeader.indexOf(']');
			if (index === -1) {
				servername = hostHeader;
			} else {
				servername = hostHeader.slice(1, -1);
			}
		} else {
			servername = hostHeader.split(':', 1)[0];
		}
	}

	if (net.isIP(servername)) {
		return '';
	}

	return servername;
};


/***/ }),

/***/ 993:
/***/ (function(__unusedmodule, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.dnsLookupIpVersionToFamily = exports.isDnsLookupIpVersion = void 0;
const conversionTable = {
    auto: 0,
    ipv4: 4,
    ipv6: 6
};
exports.isDnsLookupIpVersion = (value) => {
    return value in conversionTable;
};
exports.dnsLookupIpVersionToFamily = (dnsLookupIpVersion) => {
    if (exports.isDnsLookupIpVersion(dnsLookupIpVersion)) {
        return conversionTable[dnsLookupIpVersion];
    }
    throw new Error('Invalid DNS lookup IP version');
};


/***/ })

/******/ });
//# sourceMappingURL=index.js.map