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

/***/ 22:
/***/ (function(module) {

module.exports = {"trigram":{"albanian":{"të ":"0"," të":"1","në ":"2","për":"3"," pë":"4"," e ":"5","sht":"6"," në":"7"," sh":"8","se ":"9","et ":"10","ë s":"11","ë t":"12"," se":"13","he ":"14","jë ":"15","ër ":"16","dhe":"17"," pa":"18","ë n":"19","ë p":"20"," që":"21"," dh":"22","një":"23","ë m":"24"," nj":"25","ësh":"26","in ":"27"," me":"28","që ":"29"," po":"30","e n":"31","e t":"32","ish":"33","më ":"34","së ":"35","me ":"36","htë":"37"," ka":"38"," si":"39","e k":"40","e p":"41"," i ":"42","anë":"43","ar ":"44"," nu":"45","und":"46","ve ":"47"," ës":"48","e s":"49"," më":"50","nuk":"51","par":"52","uar":"53","uk ":"54","jo ":"55","rë ":"56","ta ":"57","ë f":"58","en ":"59","it ":"60","min":"61","het":"62","n e":"63","ri ":"64","shq":"65","ë d":"66"," do":"67"," nd":"68","sh ":"69","ën ":"70","atë":"71","hqi":"72","ist":"73","ë q":"74"," gj":"75"," ng":"76"," th":"77","a n":"78","do ":"79","end":"80","imi":"81","ndi":"82","r t":"83","rat":"84","ë b":"85","ëri":"86"," mu":"87","art":"88","ash":"89","qip":"90"," ko":"91","e m":"92","edh":"93","eri":"94","je ":"95","ka ":"96","nga":"97","si ":"98","te ":"99","ë k":"100","ësi":"101"," ma":"102"," ti":"103","eve":"104","hje":"105","ira":"106","mun":"107","on ":"108","po ":"109","re ":"110"," pr":"111","im ":"112","lit":"113","o t":"114","ur ":"115","ë e":"116","ë v":"117","ët ":"118"," ku":"119"," së":"120","e d":"121","es ":"122","ga ":"123","iti":"124","jet":"125","ndë":"126","oli":"127","shi":"128","tje":"129"," bë":"130"," z ":"131","gje":"132","kan":"133","shk":"134","ënd":"135","ës ":"136"," de":"137"," kj":"138"," ru":"139"," vi":"140","ara":"141","gov":"142","kjo":"143","or ":"144","r p":"145","rto":"146","rug":"147","tet":"148","ugo":"149","ali":"150","arr":"151","at ":"152","d t":"153","ht ":"154","i p":"155","ipë":"156","izi":"157","jnë":"158","n n":"159","ohe":"160","shu":"161","shë":"162","t e":"163","tik":"164","a e":"165","arë":"166","etë":"167","hum":"168","nd ":"169","ndr":"170","osh":"171","ova":"172","rim":"173","tos":"174","va ":"175"," fa":"176"," fi":"177","a s":"178","hen":"179","i n":"180","mar":"181","ndo":"182","por":"183","ris":"184","sa ":"185","sis":"186","tës":"187","umë":"188","viz":"189","zit":"190"," di":"191"," mb":"192","aj ":"193","ana":"194","ata":"195","dër":"196","e a":"197","esh":"198","ime":"199","jes":"200","lar":"201","n s":"202","nte":"203","pol":"204","r n":"205","ran":"206","res":"207","rrë":"208","tar":"209","ë a":"210","ë i":"211"," at":"212"," jo":"213"," kë":"214"," re":"215","a k":"216","ai ":"217","akt":"218","hë ":"219","hën":"220","i i":"221","i m":"222","ia ":"223","men":"224","nis":"225","shm":"226","str":"227","t k":"228","t n":"229","t s":"230","ë g":"231","ërk":"232","ëve":"233"," ai":"234"," ci":"235"," ed":"236"," ja":"237"," kr":"238"," qe":"239"," ta":"240"," ve":"241","a p":"242","cil":"243","el ":"244","erë":"245","gji":"246","hte":"247","i t":"248","jen":"249","jit":"250","k d":"251","mën":"252","n t":"253","nyr":"254","ori":"255","pas":"256","ra ":"257","rie":"258","rës":"259","tor":"260","uaj":"261","yre":"262","ëm ":"263","ëny":"264"," ar":"265"," du":"266"," ga":"267"," je":"268","dës":"269","e e":"270","e z":"271","ha ":"272","hme":"273","ika":"274","ini":"275","ite":"276","ith":"277","koh":"278","kra":"279","ku ":"280","lim":"281","lis":"282","qën":"283","rën":"284","s s":"285","t d":"286","t t":"287","tir":"288","tën":"289","ver":"290","ë j":"291"," ba":"292"," in":"293"," tr":"294"," zg":"295","a a":"296","a m":"297","a t":"298","abr":"299"},"arabic":{" ال":"0","الع":"1","لعر":"2","عرا":"3","راق":"4"," في":"5","في ":"6","ين ":"7","ية ":"8","ن ا":"9","الم":"10","ات ":"11","من ":"12","ي ا":"13"," من":"14","الأ":"15","ة ا":"16","اق ":"17"," وا":"18","اء ":"19","الإ":"20"," أن":"21","وال":"22","ما ":"23"," عل":"24","لى ":"25","ت ا":"26","ون ":"27","هم ":"28","اقي":"29","ام ":"30","ل ا":"31","أن ":"32","م ا":"33","الت":"34","لا ":"35","الا":"36","ان ":"37","ها ":"38","ال ":"39","ة و":"40","ا ا":"41","رها":"42","لام":"43","يين":"44"," ول":"45","لأم":"46","نا ":"47","على":"48","ن ي":"49","الب":"50","اد ":"51","الق":"52","د ا":"53","ذا ":"54","ه ا":"55"," با":"56","الد":"57","ب ا":"58","مري":"59","لم ":"60"," إن":"61"," لل":"62","سلا":"63","أمر":"64","ريك":"65","مة ":"66","ى ا":"67","ا ي":"68"," عن":"69"," هذ":"70","ء ا":"71","ر ا":"72","كان":"73","قتل":"74","إسل":"75","الح":"76","وا ":"77"," إل":"78","ا أ":"79","بال":"80","ن م":"81","الس":"82","رة ":"83","لإس":"84","ن و":"85","هاب":"86","ي و":"87","ير ":"88"," كا":"89","لة ":"90","يات":"91"," لا":"92","انت":"93","ن أ":"94","يكي":"95","الر":"96","الو":"97","ة ف":"98","دة ":"99","الج":"100","قي ":"101","وي ":"102","الذ":"103","الش":"104","امي":"105","اني":"106","ذه ":"107","عن ":"108","لما":"109","هذه":"110","ول ":"111","اف ":"112","اوي":"113","بري":"114","ة ل":"115"," أم":"116"," لم":"117"," ما":"118","يد ":"119"," أي":"120","إره":"121","ع ا":"122","عمل":"123","ولا":"124","إلى":"125","ابي":"126","ن ف":"127","ختط":"128","لك ":"129","نه ":"130","ني ":"131","إن ":"132","دين":"133","ف ا":"134","لذي":"135","ي أ":"136","ي ب":"137"," وأ":"138","ا ع":"139","الخ":"140","تل ":"141","تي ":"142","قد ":"143","لدي":"144"," كل":"145"," مع":"146","اب ":"147","اخت":"148","ار ":"149","الن":"150","علا":"151","م و":"152","مع ":"153","س ا":"154","كل ":"155","لاء":"156","ن ب":"157","ن ت":"158","ي م":"159","عرب":"160","م ب":"161"," وق":"162"," يق":"163","ا ل":"164","ا م":"165","الف":"166","تطا":"167","داد":"168","لمس":"169","له ":"170","هذا":"171"," مح":"172","ؤلا":"173","بي ":"174","ة م":"175","ن ل":"176","هؤل":"177","كن ":"178","لإر":"179","لتي":"180"," أو":"181"," ان":"182"," عم":"183","ا ف":"184","ة أ":"185","طاف":"186","عب ":"187","ل م":"188","ن ع":"189","ور ":"190","يا ":"191"," يس":"192","ا ت":"193","ة ب":"194","راء":"195","عال":"196","قوا":"197","قية":"198","لعا":"199","م ي":"200","مي ":"201","مية":"202","نية":"203","أي ":"204","ابا":"205","بغد":"206","بل ":"207","رب ":"208","عما":"209","غدا":"210","مال":"211","ملي":"212","يس ":"213"," بأ":"214"," بع":"215"," بغ":"216"," وم":"217","بات":"218","بية":"219","ذلك":"220","عة ":"221","قاو":"222","قيي":"223","كي ":"224","م م":"225","ي ع":"226"," عر":"227"," قا":"228","ا و":"229","رى ":"230","ق ا":"231","وات":"232","وم ":"233"," هؤ":"234","ا ب":"235","دام":"236","دي ":"237","رات":"238","شعب":"239","لان":"240","لشع":"241","لقو":"242","ليا":"243","ن ه":"244","ي ت":"245","ي ي":"246"," وه":"247"," يح":"248","جرا":"249","جما":"250","حمد":"251","دم ":"252","كم ":"253","لاو":"254","لره":"255","ماع":"256","ن ق":"257","نة ":"258","هي ":"259"," بل":"260"," به":"261"," له":"262"," وي":"263","ا ك":"264","اذا":"265","اع ":"266","ت م":"267","تخا":"268","خاب":"269","ر م":"270","لمت":"271","مسل":"272","ى أ":"273","يست":"274","يطا":"275"," لأ":"276"," لي":"277","أمن":"278","است":"279","بعض":"280","ة ت":"281","ري ":"282","صدا":"283","ق و":"284","قول":"285","مد ":"286","نتخ":"287","نفس":"288","نها":"289","هنا":"290","أعم":"291","أنه":"292","ائن":"293","الآ":"294","الك":"295","حة ":"296","د م":"297","ر ع":"298","ربي":"299"},"azeri":{"lər":"0","in ":"1","ın ":"2","lar":"3","da ":"4","an ":"5","ir ":"6","də ":"7","ki ":"8"," bi":"9","ən ":"10","əri":"11","arı":"12","ər ":"13","dir":"14","nda":"15"," ki":"16","rin":"17","nın":"18","əsi":"19","ini":"20"," ed":"21"," qa":"22"," tə":"23"," ba":"24"," ol":"25","ası":"26","ilə":"27","rın":"28"," ya":"29","anı":"30"," və":"31","ndə":"32","ni ":"33","ara":"34","ını":"35","ınd":"36"," bu":"37","si ":"38","ib ":"39","aq ":"40","dən":"41","iya":"42","nə ":"43","rə ":"44","n b":"45","sın":"46","və ":"47","iri":"48","lə ":"49","nin":"50","əli":"51"," de":"52"," mü":"53","bir":"54","n s":"55","ri ":"56","ək ":"57"," az":"58"," sə":"59","ar ":"60","bil":"61","zər":"62","bu ":"63","dan":"64","edi":"65","ind":"66","man":"67","un ":"68","ərə":"69"," ha":"70","lan":"71","yyə":"72","iyy":"73"," il":"74"," ne":"75","r k":"76","ə b":"77"," is":"78","na ":"79","nun":"80","ır ":"81"," da":"82"," hə":"83","a b":"84","inə":"85","sin":"86","yan":"87","ərb":"88"," də":"89"," mə":"90"," qə":"91","dır":"92","li ":"93","ola":"94","rba":"95","azə":"96","can":"97","lı ":"98","nla":"99"," et":"100"," gö":"101","alı":"102","ayc":"103","bay":"104","eft":"105","ist":"106","n i":"107","nef":"108","tlə":"109","yca":"110","yət":"111","əcə":"112"," la":"113","ild":"114","nı ":"115","tin":"116","ldi":"117","lik":"118","n h":"119","n m":"120","oyu":"121","raq":"122","ya ":"123","əti":"124"," ar":"125","ada":"126","edə":"127","mas":"128","sı ":"129","ına":"130","ə d":"131","ələ":"132","ayı":"133","iyi":"134","lma":"135","mək":"136","n d":"137","ti ":"138","yin":"139","yun":"140","ət ":"141","azı":"142","ft ":"143","i t":"144","lli":"145","n a":"146","ra ":"147"," cə":"148"," gə":"149"," ko":"150"," nə":"151"," oy":"152","a d":"153","ana":"154","cək":"155","eyi":"156","ilm":"157","irl":"158","lay":"159","liy":"160","lub":"161","n ə":"162","ril":"163","rlə":"164","unu":"165","ver":"166","ün ":"167","ə o":"168","əni":"169"," he":"170"," ma":"171"," on":"172"," pa":"173","ala":"174","dey":"175","i m":"176","ima":"177","lmə":"178","mət":"179","par":"180","yə ":"181","ətl":"182"," al":"183"," mi":"184"," sa":"185"," əl":"186","adı":"187","akı":"188","and":"189","ard":"190","art":"191","ayi":"192","i a":"193","i q":"194","i y":"195","ili":"196","ill":"197","isə":"198","n o":"199","n q":"200","olu":"201","rla":"202","stə":"203","sə ":"204","tan":"205","tel":"206","yar":"207","ədə":"208"," me":"209"," rə":"210"," ve":"211"," ye":"212","a k":"213","at ":"214","baş":"215","diy":"216","ent":"217","eti":"218","həs":"219","i i":"220","ik ":"221","la ":"222","miş":"223","n n":"224","nu ":"225","qar":"226","ran":"227","tər":"228","xan":"229","ə a":"230","ə g":"231","ə t":"232"," dü":"233","ama":"234","b k":"235","dil":"236","era":"237","etm":"238","i b":"239","kil":"240","mil":"241","n r":"242","qla":"243","r s":"244","ras":"245","siy":"246","son":"247","tim":"248","yer":"249","ə k":"250"," gü":"251"," so":"252"," sö":"253"," te":"254"," xa":"255","ai ":"256","bar":"257","cti":"258","di ":"259","eri":"260","gör":"261","gün":"262","gəl":"263","hbə":"264","ihə":"265","iki":"266","isi":"267","lin":"268","mai":"269","maq":"270","n k":"271","n t":"272","n v":"273","onu":"274","qan":"275","qəz":"276","tə ":"277","xal":"278","yib":"279","yih":"280","zet":"281","zır":"282","ıb ":"283","ə m":"284","əze":"285"," br":"286"," in":"287"," i̇":"288"," pr":"289"," ta":"290"," to":"291"," üç":"292","a o":"293","ali":"294","ani":"295","anl":"296","aql":"297","azi":"298","bri":"299"},"bengali":{"ার ":"0","য় ":"1","েয়":"2","য়া":"3"," কর":"4","েত ":"5"," কা":"6"," পা":"7"," তা":"8","না ":"9","ায়":"10","ের ":"11","য়ে":"12"," বা":"13","েব ":"14"," যা":"15"," হে":"16"," সা":"17","ান ":"18","েছ ":"19"," িন":"20","েল ":"21"," িদ":"22"," না":"23"," িব":"24","েক ":"25","লা ":"26","তা ":"27"," বઘ":"28"," িক":"29","করে":"30"," পચ":"31","াের":"32","িনে":"33","রা ":"34"," োব":"35","কা ":"36"," কে":"37"," টা":"38","র ক":"39","েলা":"40"," োক":"41"," মা":"42"," োদ":"43"," োম":"44","দর ":"45","়া ":"46","িদে":"47","াকা":"48","়েছ":"49","েদর":"50"," আে":"51"," ও ":"52","াল ":"53","িট ":"54"," মু":"55","কের":"56","হয়":"57","করা":"58","পর ":"59","পাে":"60"," এক":"61"," পদ":"62","টাক":"63","ড় ":"64","কান":"65","টা ":"66","দગা":"67","পদગ":"68","াড়":"69","োকা":"70","ওয়":"71","কাপ":"72","হেয":"73","েনর":"74"," হয":"75","দেয":"76","নর ":"77","ানা":"78","ােল":"79"," আর":"80"," ় ":"81","বઘব":"82","িয়":"83"," দা":"84"," সম":"85","কার":"86","হার":"87","াই ":"88","ড়া":"89","িবি":"90"," রা":"91"," লা":"92","নার":"93","বহা":"94","বা ":"95","যায":"96","েন ":"97","ઘবহ":"98"," ভা":"99"," সে":"100"," োয":"101","রর ":"102","়ার":"103","়াল":"104","ગা ":"105","থেক":"106","ভাে":"107","়ে ":"108","েরর":"109"," ধর":"110"," হা":"111","নઘ ":"112","রেন":"113","ােব":"114","িড়":"115","ির ":"116"," োথ":"117","তার":"118","বিভ":"119","রেত":"120","সাে":"121","াকে":"122","ােত":"123","িভਭ":"124","ে ব":"125","োথে":"126"," োপ":"127"," োস":"128","বার":"129","ভਭ ":"130","রন ":"131","াম ":"132"," এখ":"133","আর ":"134","কাে":"135","দন ":"136","সাজ":"137","ােক":"138","ােন":"139","েনা":"140"," ঘে":"141"," তে":"142"," রে":"143","তেব":"144","বন ":"145","বઘা":"146","েড়":"147","েবন":"148"," খু":"149"," চা":"150"," সু":"151","কে ":"152","ধরে":"153","র ো":"154","় ি":"155","া ি":"156","ােথ":"157","াਠা":"158","িদ ":"159","িন ":"160"," অন":"161"," আপ":"162"," আম":"163"," থা":"164"," বચ":"165"," োফ":"166"," ৌত":"167","ঘের":"168","তে ":"169","ময়":"170","যাਠ":"171","র স":"172","রাখ":"173","া ব":"174","া ো":"175","ালা":"176","িক ":"177","িশ ":"178","েখ ":"179"," এর":"180"," চઓ":"181"," িড":"182","খন ":"183","ড়ে":"184","র ব":"185","়র ":"186","াইে":"187","ােদ":"188","িদন":"189","েরন":"190"," তੴ":"191","ছাড":"192","জনઘ":"193","তাই":"194","মা ":"195","মাে":"196","লার":"197","াজ ":"198","াতা":"199","ামা":"200","ਊেল":"201","ગার":"202"," সব":"203","আপন":"204","একট":"205","কাি":"206","জাই":"207","টর ":"208","ডজা":"209","দেখ":"210","পনা":"211","রও ":"212","লে ":"213","হেব":"214","াজা":"215","ািট":"216","িডজ":"217","েথ ":"218"," এব":"219"," জন":"220"," জা":"221","আমা":"222","গেল":"223","জান":"224","নেত":"225","বিশ":"226","মুে":"227","মেয":"228","র প":"229","সে ":"230","হেল":"231","় ো":"232","া হ":"233","াওয":"234","োমক":"235","ઘাি":"236"," অে":"237"," ট ":"238"," োগ":"239"," োন":"240","জর ":"241","তির":"242","দাম":"243","পড়":"244","পার":"245","বাঘ":"246","মকা":"247","মাম":"248","য়র":"249","যাে":"250","র ম":"251","রে ":"252","লর ":"253","া ক":"254","াগ ":"255","াবা":"256","ারা":"257","ািন":"258","ে গ":"259","েগ ":"260","েলর":"261","োদখ":"262","োবি":"263","ઓল ":"264"," দে":"265"," পু":"266"," বে":"267","অেন":"268","এখন":"269","কছু":"270","কাল":"271","গেয":"272","ছন ":"273","ত প":"274","নেয":"275","পাি":"276","মন ":"277","র আ":"278","রার":"279","াও ":"280","াপ ":"281","িকছ":"282","িগে":"283","েছন":"284","েজর":"285","োমা":"286","োমে":"287","ৌতি":"288","ઘাে":"289"," ' ":"290"," এছ":"291"," ছা":"292"," বল":"293"," যি":"294"," শি":"295"," িম":"296"," োল":"297","এছা":"298","খা ":"299"},"bulgarian":{"на ":"0"," на":"1","то ":"2"," пр":"3"," за":"4","та ":"5"," по":"6","ите":"7","те ":"8","а п":"9","а с":"10"," от":"11","за ":"12","ата":"13","ия ":"14"," в ":"15","е н":"16"," да":"17","а н":"18"," се":"19"," ко":"20","да ":"21","от ":"22","ани":"23","пре":"24","не ":"25","ени":"26","о н":"27","ни ":"28","се ":"29"," и ":"30","но ":"31","ане":"32","ето":"33","а в":"34","ва ":"35","ван":"36","е п":"37","а о":"38","ото":"39","ран":"40","ат ":"41","ред":"42"," не":"43","а д":"44","и п":"45"," до":"46","про":"47"," съ":"48","ли ":"49","при":"50","ния":"51","ски":"52","тел":"53","а и":"54","по ":"55","ри ":"56"," е ":"57"," ка":"58","ира":"59","кат":"60","ние":"61","нит":"62","е з":"63","и с":"64","о с":"65","ост":"66","че ":"67"," ра":"68","ист":"69","о п":"70"," из":"71"," са":"72","е д":"73","ини":"74","ки ":"75","мин":"76"," ми":"77","а б":"78","ава":"79","е в":"80","ие ":"81","пол":"82","ств":"83","т н":"84"," въ":"85"," ст":"86"," то":"87","аза":"88","е о":"89","ов ":"90","ст ":"91","ът ":"92","и н":"93","ият":"94","нат":"95","ра ":"96"," бъ":"97"," че":"98","алн":"99","е с":"100","ен ":"101","ест":"102","и д":"103","лен":"104","нис":"105","о о":"106","ови":"107"," об":"108"," сл":"109","а р":"110","ато":"111","кон":"112","нос":"113","ров":"114","ще ":"115"," ре":"116"," с ":"117"," сп":"118","ват":"119","еше":"120","и в":"121","иет":"122","о в":"123","ове":"124","ста":"125","а к":"126","а т":"127","дат":"128","ент":"129","ка ":"130","лед":"131","нет":"132","ори":"133","стр":"134","стъ":"135","ти ":"136","тър":"137"," те":"138","а з":"139","а м":"140","ад ":"141","ана":"142","ено":"143","и о":"144","ина":"145","ити":"146","ма ":"147","ска":"148","сле":"149","тво":"150","тер":"151","ция":"152","ят ":"153"," бе":"154"," де":"155"," па":"156","ате":"157","вен":"158","ви ":"159","вит":"160","и з":"161","и и":"162","нар":"163","нов":"164","ова":"165","пов":"166","рез":"167","рит":"168","са ":"169","ята":"170"," го":"171"," ще":"172","али":"173","в п":"174","гра":"175","е и":"176","еди":"177","ели":"178","или":"179","каз":"180","кит":"181","лно":"182","мен":"183","оли":"184","раз":"185"," ве":"186"," гр":"187"," им":"188"," ме":"189"," пъ":"190","ави":"191","ако":"192","ача":"193","вин":"194","во ":"195","гов":"196","дан":"197","ди ":"198","до ":"199","ед ":"200","ери":"201","еро":"202","жда":"203","ито":"204","ков":"205","кол":"206","лни":"207","мер":"208","нач":"209","о з":"210","ола":"211","он ":"212","она":"213","пра":"214","рав":"215","рем":"216","сия":"217","сти":"218","т п":"219","тан":"220","ха ":"221","ше ":"222","шен":"223","ълг":"224"," ба":"225"," си":"226","аро":"227","бъл":"228","в р":"229","гар":"230","е е":"231","елн":"232","еме":"233","ико":"234","има":"235","ко ":"236","кои":"237","ла ":"238","лга":"239","о д":"240","ози":"241","оит":"242","под":"243","рес":"244","рие":"245","сто":"246","т к":"247","т м":"248","т с":"249","уст":"250"," би":"251"," дв":"252"," дъ":"253"," ма":"254"," мо":"255"," ни":"256"," ос":"257","ала":"258","анс":"259","ара":"260","ати":"261","аци":"262","беш":"263","вър":"264","е р":"265","едв":"266","ема":"267","жав":"268","и к":"269","иал":"270","ица":"271","иче":"272","кия":"273","лит":"274","о б":"275","ово":"276","оди":"277","ока":"278","пос":"279","род":"280","сед":"281","слу":"282","т и":"283","тов":"284","ува":"285","циа":"286","чес":"287","я з":"288"," во":"289"," ил":"290"," ск":"291"," тр":"292"," це":"293","ами":"294","ари":"295","бат":"296","би ":"297","бра":"298","бъд":"299"},"cebuano":{"ng ":"0","sa ":"1"," sa":"2","ang":"3","ga ":"4","nga":"5"," ka":"6"," ng":"7","an ":"8"," an":"9"," na":"10"," ma":"11"," ni":"12","a s":"13","a n":"14","on ":"15"," pa":"16"," si":"17","a k":"18","a m":"19"," ba":"20","ong":"21","a i":"22","ila":"23"," mg":"24","mga":"25","a p":"26","iya":"27","a a":"28","ay ":"29","ka ":"30","ala":"31","ing":"32","g m":"33","n s":"34","g n":"35","lan":"36"," gi":"37","na ":"38","ni ":"39","o s":"40","g p":"41","n n":"42"," da":"43","ag ":"44","pag":"45","g s":"46","yan":"47","ayo":"48","o n":"49","si ":"50"," mo":"51","a b":"52","g a":"53","ail":"54","g b":"55","han":"56","a d":"57","asu":"58","nag":"59","ya ":"60","man":"61","ne ":"62","pan":"63","kon":"64"," il":"65"," la":"66","aka":"67","ako":"68","ana":"69","bas":"70","ko ":"71","od ":"72","yo ":"73"," di":"74"," ko":"75"," ug":"76","a u":"77","g k":"78","kan":"79","la ":"80","len":"81","sur":"82","ug ":"83"," ai":"84","apa":"85","aw ":"86","d s":"87","g d":"88","g g":"89","ile":"90","nin":"91"," iy":"92"," su":"93","ene":"94","og ":"95","ot ":"96","aba":"97","aha":"98","as ":"99","imo":"100"," ki":"101","a t":"102","aga":"103","ban":"104","ero":"105","nan":"106","o k":"107","ran":"108","ron":"109","sil":"110","una":"111","usa":"112"," us":"113","a g":"114","ahi":"115","ani":"116","er ":"117","ha ":"118","i a":"119","rer":"120","yon":"121"," pu":"122","ini":"123","nak":"124","ro ":"125","to ":"126","ure":"127"," ed":"128"," og":"129"," wa":"130","ili":"131","mo ":"132","n a":"133","nd ":"134","o a":"135"," ad":"136"," du":"137"," pr":"138","aro":"139","i s":"140","ma ":"141","n m":"142","ulo":"143","und":"144"," ta":"145","ara":"146","asa":"147","ato":"148","awa":"149","dmu":"150","e n":"151","edm":"152","ina":"153","mak":"154","mun":"155","niy":"156","san":"157","wa ":"158"," tu":"159"," un":"160","a l":"161","bay":"162","iga":"163","ika":"164","ita":"165","kin":"166","lis":"167","may":"168","os ":"169"," ar":"170","ad ":"171","ali":"172","ama":"173","ers":"174","ipa":"175","isa":"176","mao":"177","nim":"178","t s":"179","tin":"180"," ak":"181"," ap":"182"," hi":"183","abo":"184","agp":"185","ano":"186","ata":"187","g i":"188","gan":"189","gka":"190","gpa":"191","i m":"192","iha":"193","k s":"194","law":"195","or ":"196","rs ":"197","siy":"198","tag":"199"," al":"200"," at":"201"," ha":"202"," hu":"203"," im":"204","a h":"205","bu ":"206","e s":"207","gma":"208","kas":"209","lag":"210","mon":"211","nah":"212","ngo":"213","r s":"214","ra ":"215","sab":"216","sam":"217","sul":"218","uba":"219","uha":"220"," lo":"221"," re":"222","ada":"223","aki":"224","aya":"225","bah":"226","ce ":"227","d n":"228","lab":"229","pa ":"230","pak":"231","s n":"232","s s":"233","tan":"234","taw":"235","te ":"236","uma":"237","ura":"238"," in":"239"," lu":"240","a c":"241","abi":"242","at ":"243","awo":"244","bat":"245","dal":"246","dla":"247","ele":"248","g t":"249","g u":"250","gay":"251","go ":"252","hab":"253","hin":"254","i e":"255","i n":"256","kab":"257","kap":"258","lay":"259","lin":"260","nil":"261","pam":"262","pas":"263","pro":"264","pul":"265","ta ":"266","ton":"267","uga":"268","ugm":"269","unt":"270"," co":"271"," gu":"272"," mi":"273"," pi":"274"," ti":"275","a o":"276","abu":"277","adl":"278","ado":"279","agh":"280","agk":"281","ao ":"282","art":"283","bal":"284","cit":"285","di ":"286","dto":"287","dun":"288","ent":"289","g e":"290","gon":"291","gug":"292","ia ":"293","iba":"294","ice":"295","in ":"296","inu":"297","it ":"298","kaa":"299"},"croatian":{"je ":"0"," na":"1"," pr":"2"," po":"3","na ":"4"," je":"5"," za":"6","ije":"7","ne ":"8"," i ":"9","ti ":"10","da ":"11"," ko":"12"," ne":"13","li ":"14"," bi":"15"," da":"16"," u ":"17","ma ":"18","mo ":"19","a n":"20","ih ":"21","za ":"22","a s":"23","ko ":"24","i s":"25","a p":"26","koj":"27","pro":"28","ju ":"29","se ":"30"," go":"31","ost":"32","to ":"33","va ":"34"," do":"35"," to":"36","e n":"37","i p":"38"," od":"39"," ra":"40","no ":"41","ako":"42","ka ":"43","ni ":"44"," ka":"45"," se":"46"," mo":"47"," st":"48","i n":"49","ima":"50","ja ":"51","pri":"52","vat":"53","sta":"54"," su":"55","ati":"56","e p":"57","ta ":"58","tsk":"59","e i":"60","nij":"61"," tr":"62","cij":"63","jen":"64","nos":"65","o s":"66"," iz":"67","om ":"68","tro":"69","ili":"70","iti":"71","pos":"72"," al":"73","a i":"74","a o":"75","e s":"76","ija":"77","ini":"78","pre":"79","str":"80","la ":"81","og ":"82","ovo":"83"," sv":"84","ekt":"85","nje":"86","o p":"87","odi":"88","rva":"89"," ni":"90","ali":"91","min":"92","rij":"93","a t":"94","a z":"95","ats":"96","iva":"97","o t":"98","od ":"99","oje":"100","ra ":"101"," hr":"102","a m":"103","a u":"104","hrv":"105","im ":"106","ke ":"107","o i":"108","ovi":"109","red":"110","riv":"111","te ":"112","bi ":"113","e o":"114","god":"115","i d":"116","lek":"117","umi":"118","zvo":"119","din":"120","e u":"121","ene":"122","jed":"123","ji ":"124","lje":"125","nog":"126","su ":"127"," a ":"128"," el":"129"," mi":"130"," o ":"131","a d":"132","alu":"133","ele":"134","i u":"135","izv":"136","ktr":"137","lum":"138","o d":"139","ori":"140","rad":"141","sto":"142","a k":"143","anj":"144","ava":"145","e k":"146","men":"147","nic":"148","o j":"149","oj ":"150","ove":"151","ski":"152","tvr":"153","una":"154","vor":"155"," di":"156"," no":"157"," s ":"158"," ta":"159"," tv":"160","i i":"161","i o":"162","kak":"163","roš":"164","sko":"165","vod":"166"," sa":"167"," će":"168","a b":"169","adi":"170","amo":"171","eni":"172","gov":"173","iju":"174","ku ":"175","o n":"176","ora":"177","rav":"178","ruj":"179","smo":"180","tav":"181","tru":"182","u p":"183","ve ":"184"," in":"185"," pl":"186","aci":"187","bit":"188","de ":"189","diš":"190","ema":"191","i m":"192","ika":"193","išt":"194","jer":"195","ki ":"196","mog":"197","nik":"198","nov":"199","nu ":"200","oji":"201","oli":"202","pla":"203","pod":"204","st ":"205","sti":"206","tra":"207","tre":"208","vo ":"209"," sm":"210"," št":"211","dan":"212","e z":"213","i t":"214","io ":"215","ist":"216","kon":"217","lo ":"218","stv":"219","u s":"220","uje":"221","ust":"222","će ":"223","ći ":"224","što":"225"," dr":"226"," im":"227"," li":"228","ada":"229","aft":"230","ani":"231","ao ":"232","ars":"233","ata":"234","e t":"235","emo":"236","i k":"237","ine":"238","jem":"239","kov":"240","lik":"241","lji":"242","mje":"243","naf":"244","ner":"245","nih":"246","nja":"247","ogo":"248","oiz":"249","ome":"250","pot":"251","ran":"252","ri ":"253","roi":"254","rtk":"255","ska":"256","ter":"257","u i":"258","u o":"259","vi ":"260","vrt":"261"," me":"262"," ug":"263","ak ":"264","ama":"265","drž":"266","e e":"267","e g":"268","e m":"269","em ":"270","eme":"271","enj":"272","ent":"273","er ":"274","ere":"275","erg":"276","eur":"277","go ":"278","i b":"279","i z":"280","jet":"281","ksi":"282","o u":"283","oda":"284","ona":"285","pra":"286","reb":"287","rem":"288","rop":"289","tri":"290","žav":"291"," ci":"292"," eu":"293"," re":"294"," te":"295"," uv":"296"," ve":"297","aju":"298","an ":"299"},"czech":{" pr":"0"," po":"1","ní ":"2","pro":"3"," na":"4","na ":"5"," př":"6","ch ":"7"," je":"8"," ne":"9","že ":"10"," že":"11"," se":"12"," do":"13"," ro":"14"," st":"15"," v ":"16"," ve":"17","pře":"18","se ":"19","ho ":"20","sta":"21"," to":"22"," vy":"23"," za":"24","ou ":"25"," a ":"26","to ":"27"," by":"28","la ":"29","ce ":"30","e v":"31","ist":"32","le ":"33","pod":"34","í p":"35"," vl":"36","e n":"37","e s":"38","je ":"39","ké ":"40","by ":"41","em ":"42","ých":"43"," od":"44","ova":"45","řed":"46","dy ":"47","ení":"48","kon":"49","li ":"50","ně ":"51","str":"52"," zá":"53","ve ":"54"," ka":"55"," sv":"56","e p":"57","it ":"58","lád":"59","oho":"60","rov":"61","roz":"62","ter":"63","vlá":"64","ím ":"65"," ko":"66","hod":"67","nis":"68","pří":"69","ský":"70"," mi":"71"," ob":"72"," so":"73","a p":"74","ali":"75","bud":"76","edn":"77","ick":"78","kte":"79","ku ":"80","o s":"81","al ":"82","ci ":"83","e t":"84","il ":"85","ny ":"86","né ":"87","odl":"88","ová":"89","rot":"90","sou":"91","ání":"92"," bu":"93"," mo":"94"," o ":"95","ast":"96","byl":"97","de ":"98","ek ":"99","ost":"100"," mí":"101"," ta":"102","es ":"103","jed":"104","ky ":"105","las":"106","m p":"107","nes":"108","ním":"109","ran":"110","rem":"111","ros":"112","ého":"113"," de":"114"," kt":"115"," ni":"116"," si":"117"," vý":"118","at ":"119","jí ":"120","ký ":"121","mi ":"122","pre":"123","tak":"124","tan":"125","y v":"126","řek":"127"," ch":"128"," li":"129"," ná":"130"," pa":"131"," ře":"132","da ":"133","dle":"134","dne":"135","i p":"136","i v":"137","ly ":"138","min":"139","o n":"140","o v":"141","pol":"142","tra":"143","val":"144","vní":"145","ích":"146","ý p":"147","řej":"148"," ce":"149"," kd":"150"," le":"151","a s":"152","a z":"153","cen":"154","e k":"155","eds":"156","ekl":"157","emi":"158","kl ":"159","lat":"160","lo ":"161","mié":"162","nov":"163","pra":"164","sku":"165","ské":"166","sti":"167","tav":"168","ti ":"169","ty ":"170","ván":"171","vé ":"172","y n":"173","y s":"174","í s":"175","í v":"176","ě p":"177"," dn":"178"," ně":"179"," sp":"180"," čs":"181","a n":"182","a t":"183","ak ":"184","dní":"185","doh":"186","e b":"187","e m":"188","ejn":"189","ena":"190","est":"191","ini":"192","m z":"193","nal":"194","nou":"195","ná ":"196","ovi":"197","ové":"198","ový":"199","rsk":"200","stá":"201","tí ":"202","tře":"203","tů ":"204","ude":"205","za ":"206","é p":"207","ém ":"208","í d":"209"," ir":"210"," zv":"211","ale":"212","aně":"213","ave":"214","cké":"215","den":"216","e z":"217","ech":"218","en ":"219","erý":"220","hla":"221","i s":"222","iér":"223","lov":"224","mu ":"225","neb":"226","nic":"227","o b":"228","o m":"229","pad":"230","pot":"231","rav":"232","rop":"233","rý ":"234","sed":"235","si ":"236","t p":"237","tic":"238","tu ":"239","tě ":"240","u p":"241","u v":"242","vá ":"243","výš":"244","zvý":"245","ční":"246","ří ":"247","ům ":"248"," bl":"249"," br":"250"," ho":"251"," ja":"252"," re":"253"," s ":"254"," z ":"255"," zd":"256","a v":"257","ani":"258","ato":"259","bla":"260","bri":"261","ečn":"262","eře":"263","h v":"264","i n":"265","ie ":"266","ila":"267","irs":"268","ite":"269","kov":"270","nos":"271","o o":"272","o p":"273","oce":"274","ody":"275","ohl":"276","oli":"277","ovo":"278","pla":"279","poč":"280","prá":"281","ra ":"282","rit":"283","rod":"284","ry ":"285","sd ":"286","sko":"287","ssd":"288","tel":"289","u s":"290","vat":"291","veř":"292","vit":"293","vla":"294","y p":"295","áln":"296","čss":"297","šen":"298"," al":"299"},"danish":{"er ":"0","en ":"1"," de":"2","et ":"3","der":"4","de ":"5","for":"6"," fo":"7"," i ":"8","at ":"9"," at":"10","re ":"11","det":"12"," ha":"13","nde":"14","ere":"15","ing":"16","den":"17"," me":"18"," og":"19","ger":"20","ter":"21"," er":"22"," si":"23","and":"24"," af":"25","or ":"26"," st":"27"," ti":"28"," en":"29","og ":"30","ar ":"31","il ":"32","r s":"33","ige":"34","til":"35","ke ":"36","r e":"37","af ":"38","kke":"39"," ma":"40"," på":"41","om ":"42","på ":"43","ed ":"44","ge ":"45","end":"46","nge":"47","t s":"48","e s":"49","ler":"50"," sk":"51","els":"52","ern":"53","sig":"54","ne ":"55","lig":"56","r d":"57","ska":"58"," vi":"59","har":"60"," be":"61"," se":"62","an ":"63","ikk":"64","lle":"65","gen":"66","n f":"67","ste":"68","t a":"69","t d":"70","rin":"71"," ik":"72","es ":"73","ng ":"74","ver":"75","r b":"76","sen":"77","ede":"78","men":"79","r i":"80"," he":"81"," et":"82","ig ":"83","lan":"84","med":"85","nd ":"86","rne":"87"," da":"88"," in":"89","e t":"90","mme":"91","und":"92"," om":"93","e e":"94","e m":"95","her":"96","le ":"97","r f":"98","t f":"99","så ":"100","te ":"101"," so":"102","ele":"103","t e":"104"," ko":"105","est":"106","ske":"107"," bl":"108","e f":"109","ekt":"110","mar":"111","bru":"112","e a":"113","el ":"114","ers":"115","ret":"116","som":"117","tte":"118","ve ":"119"," la":"120"," ud":"121"," ve":"122","age":"123","e d":"124","e h":"125","lse":"126","man":"127","rug":"128","sel":"129","ser":"130"," fi":"131"," op":"132"," pr":"133","dt ":"134","e i":"135","n m":"136","r m":"137"," an":"138"," re":"139"," sa":"140","ion":"141","ner":"142","res":"143","t i":"144","get":"145","n s":"146","one":"147","orb":"148","t h":"149","vis":"150","år ":"151"," fr":"152","bil":"153","e k":"154","ens":"155","ind":"156","omm":"157","t m":"158"," hv":"159"," je":"160","dan":"161","ent":"162","fte":"163","nin":"164"," mi":"165","e o":"166","e p":"167","n o":"168","nte":"169"," ku":"170","ell":"171","nas":"172","ore":"173","r h":"174","r k":"175","sta":"176","sto":"177","dag":"178","eri":"179","kun":"180","lde":"181","mer":"182","r a":"183","r v":"184","rek":"185","rer":"186","t o":"187","tor":"188","tør":"189"," få":"190"," må":"191"," to":"192","boe":"193","che":"194","e v":"195","i d":"196","ive":"197","kab":"198","ns ":"199","oel":"200","se ":"201","t v":"202"," al":"203"," bo":"204"," un":"205","ans":"206","dre":"207","ire":"208","køb":"209","ors":"210","ove":"211","ren":"212","t b":"213","ør ":"214"," ka":"215","ald":"216","bet":"217","gt ":"218","isk":"219","kal":"220","kom":"221","lev":"222","n d":"223","n i":"224","pri":"225","r p":"226","rbr":"227","søg":"228","tel":"229"," så":"230"," te":"231"," va":"232","al ":"233","dir":"234","eje":"235","fis":"236","gså":"237","isc":"238","jer":"239","ker":"240","ogs":"241","sch":"242","st ":"243","t k":"244","uge":"245"," di":"246","ag ":"247","d a":"248","g i":"249","ill":"250","l a":"251","lsk":"252","n a":"253","on ":"254","sam":"255","str":"256","tet":"257","var":"258"," mo":"259","art":"260","ash":"261","att":"262","e b":"263","han":"264","hav":"265","kla":"266","kon":"267","n t":"268","ned":"269","r o":"270","ra ":"271","rre":"272","ves":"273","vil":"274"," el":"275"," kr":"276"," ov":"277","ann":"278","e u":"279","ess":"280","fra":"281","g a":"282","g d":"283","int":"284","ngs":"285","rde":"286","tra":"287"," år":"288","akt":"289","asi":"290","em ":"291","gel":"292","gym":"293","hol":"294","kan":"295","mna":"296","n h":"297","nsk":"298","old":"299"},"dutch":{"en ":"0","de ":"1"," de":"2","et ":"3","an ":"4"," he":"5","er ":"6"," va":"7","n d":"8","van":"9","een":"10","het":"11"," ge":"12","oor":"13"," ee":"14","der":"15"," en":"16","ij ":"17","aar":"18","gen":"19","te ":"20","ver":"21"," in":"22"," me":"23","aan":"24","den":"25"," we":"26","at ":"27","in ":"28"," da":"29"," te":"30","eer":"31","nde":"32","ter":"33","ste":"34","n v":"35"," vo":"36"," zi":"37","ing":"38","n h":"39","voo":"40","is ":"41"," op":"42","tie":"43"," aa":"44","ede":"45","erd":"46","ers":"47"," be":"48","eme":"49","ten":"50","ken":"51","n e":"52"," ni":"53"," ve":"54","ent":"55","ijn":"56","jn ":"57","mee":"58","iet":"59","n w":"60","ng ":"61","nie":"62"," is":"63","cht":"64","dat":"65","ere":"66","ie ":"67","ijk":"68","n b":"69","rde":"70","ar ":"71","e b":"72","e a":"73","met":"74","t d":"75","el ":"76","ond":"77","t h":"78"," al":"79","e w":"80","op ":"81","ren":"82"," di":"83"," on":"84","al ":"85","and":"86","bij":"87","zij":"88"," bi":"89"," hi":"90"," wi":"91","or ":"92","r d":"93","t v":"94"," wa":"95","e h":"96","lle":"97","rt ":"98","ang":"99","hij":"100","men":"101","n a":"102","n z":"103","rs ":"104"," om":"105","e o":"106","e v":"107","end":"108","est":"109","n t":"110","par":"111"," pa":"112"," pr":"113"," ze":"114","e g":"115","e p":"116","n p":"117","ord":"118","oud":"119","raa":"120","sch":"121","t e":"122","ege":"123","ich":"124","ien":"125","aat":"126","ek ":"127","len":"128","n m":"129","nge":"130","nt ":"131","ove":"132","rd ":"133","wer":"134"," ma":"135"," mi":"136","daa":"137","e k":"138","lij":"139","mer":"140","n g":"141","n o":"142","om ":"143","sen":"144","t b":"145","wij":"146"," ho":"147","e m":"148","ele":"149","gem":"150","heb":"151","pen":"152","ude":"153"," bo":"154"," ja":"155","die":"156","e e":"157","eli":"158","erk":"159","le ":"160","pro":"161","rij":"162"," er":"163"," za":"164","e d":"165","ens":"166","ind":"167","ke ":"168","n k":"169","nd ":"170","nen":"171","nte":"172","r h":"173","s d":"174","s e":"175","t z":"176"," b ":"177"," co":"178"," ik":"179"," ko":"180"," ov":"181","eke":"182","hou":"183","ik ":"184","iti":"185","lan":"186","ns ":"187","t g":"188","t m":"189"," do":"190"," le":"191"," zo":"192","ams":"193","e z":"194","g v":"195","it ":"196","je ":"197","ls ":"198","maa":"199","n i":"200","nke":"201","rke":"202","uit":"203"," ha":"204"," ka":"205"," mo":"206"," re":"207"," st":"208"," to":"209","age":"210","als":"211","ark":"212","art":"213","ben":"214","e r":"215","e s":"216","ert":"217","eze":"218","ht ":"219","ijd":"220","lem":"221","r v":"222","rte":"223","t p":"224","zeg":"225","zic":"226","aak":"227","aal":"228","ag ":"229","ale":"230","bbe":"231","ch ":"232","e t":"233","ebb":"234","erz":"235","ft ":"236","ge ":"237","led":"238","mst":"239","n n":"240","oek":"241","r i":"242","t o":"243","t w":"244","tel":"245","tte":"246","uur":"247","we ":"248","zit":"249"," af":"250"," li":"251"," ui":"252","ak ":"253","all":"254","aut":"255","doo":"256","e i":"257","ene":"258","erg":"259","ete":"260","ges":"261","hee":"262","jaa":"263","jke":"264","kee":"265","kel":"266","kom":"267","lee":"268","moe":"269","n s":"270","ort":"271","rec":"272","s o":"273","s v":"274","teg":"275","tij":"276","ven":"277","waa":"278","wel":"279"," an":"280"," au":"281"," bu":"282"," gr":"283"," pl":"284"," ti":"285","'' ":"286","ade":"287","dag":"288","e l":"289","ech":"290","eel":"291","eft":"292","ger":"293","gt ":"294","ig ":"295","itt":"296","j d":"297","ppe":"298","rda":"299"},"english":{" th":"0","the":"1","he ":"2","ed ":"3"," to":"4"," in":"5","er ":"6","ing":"7","ng ":"8"," an":"9","nd ":"10"," of":"11","and":"12","to ":"13","of ":"14"," co":"15","at ":"16","on ":"17","in ":"18"," a ":"19","d t":"20"," he":"21","e t":"22","ion":"23","es ":"24"," re":"25","re ":"26","hat":"27"," sa":"28"," st":"29"," ha":"30","her":"31","tha":"32","tio":"33","or ":"34"," ''":"35","en ":"36"," wh":"37","e s":"38","ent":"39","n t":"40","s a":"41","as ":"42","for":"43","is ":"44","t t":"45"," be":"46","ld ":"47","e a":"48","rs ":"49"," wa":"50","ut ":"51","ve ":"52","ll ":"53","al ":"54"," ma":"55","e i":"56"," fo":"57","'s ":"58","an ":"59","est":"60"," hi":"61"," mo":"62"," se":"63"," pr":"64","s t":"65","ate":"66","st ":"67","ter":"68","ere":"69","ted":"70","nt ":"71","ver":"72","d a":"73"," wi":"74","se ":"75","e c":"76","ect":"77","ns ":"78"," on":"79","ly ":"80","tol":"81","ey ":"82","r t":"83"," ca":"84","ati":"85","ts ":"86","all":"87"," no":"88","his":"89","s o":"90","ers":"91","con":"92","e o":"93","ear":"94","f t":"95","e w":"96","was":"97","ons":"98","sta":"99","'' ":"100","sti":"101","n a":"102","sto":"103","t h":"104"," we":"105","id ":"106","th ":"107"," it":"108","ce ":"109"," di":"110","ave":"111","d h":"112","cou":"113","pro":"114","ad ":"115","oll":"116","ry ":"117","d s":"118","e m":"119"," so":"120","ill":"121","cti":"122","te ":"123","tor":"124","eve":"125","g t":"126","it ":"127"," ch":"128"," de":"129","hav":"130","oul":"131","ty ":"132","uld":"133","use":"134"," al":"135","are":"136","ch ":"137","me ":"138","out":"139","ove":"140","wit":"141","ys ":"142","chi":"143","t a":"144","ith":"145","oth":"146"," ab":"147"," te":"148"," wo":"149","s s":"150","res":"151","t w":"152","tin":"153","e b":"154","e h":"155","nce":"156","t s":"157","y t":"158","e p":"159","ele":"160","hin":"161","s i":"162","nte":"163"," li":"164","le ":"165"," do":"166","aid":"167","hey":"168","ne ":"169","s w":"170"," as":"171"," fr":"172"," tr":"173","end":"174","sai":"175"," el":"176"," ne":"177"," su":"178","'t ":"179","ay ":"180","hou":"181","ive":"182","lec":"183","n't":"184"," ye":"185","but":"186","d o":"187","o t":"188","y o":"189"," ho":"190"," me":"191","be ":"192","cal":"193","e e":"194","had":"195","ple":"196"," at":"197"," bu":"198"," la":"199","d b":"200","s h":"201","say":"202","t i":"203"," ar":"204","e f":"205","ght":"206","hil":"207","igh":"208","int":"209","not":"210","ren":"211"," is":"212"," pa":"213"," sh":"214","ays":"215","com":"216","n s":"217","r a":"218","rin":"219","y a":"220"," un":"221","n c":"222","om ":"223","thi":"224"," mi":"225","by ":"226","d i":"227","e d":"228","e n":"229","t o":"230"," by":"231","e r":"232","eri":"233","old":"234","ome":"235","whe":"236","yea":"237"," gr":"238","ar ":"239","ity":"240","mpl":"241","oun":"242","one":"243","ow ":"244","r s":"245","s f":"246","tat":"247"," ba":"248"," vo":"249","bou":"250","sam":"251","tim":"252","vot":"253","abo":"254","ant":"255","ds ":"256","ial":"257","ine":"258","man":"259","men":"260"," or":"261"," po":"262","amp":"263","can":"264","der":"265","e l":"266","les":"267","ny ":"268","ot ":"269","rec":"270","tes":"271","tho":"272","ica":"273","ild":"274","ir ":"275","nde":"276","ose":"277","ous":"278","pre":"279","ste":"280","era":"281","per":"282","r o":"283","red":"284","rie":"285"," bo":"286"," le":"287","ali":"288","ars":"289","ore":"290","ric":"291","s m":"292","str":"293"," fa":"294","ess":"295","ie ":"296","ist":"297","lat":"298","uri":"299"},"estonian":{"st ":"0"," ka":"1","on ":"2","ja ":"3"," va":"4"," on":"5"," ja":"6"," ko":"7","se ":"8","ast":"9","le ":"10","es ":"11","as ":"12","is ":"13","ud ":"14"," sa":"15","da ":"16","ga ":"17"," ta":"18","aja":"19","sta":"20"," ku":"21"," pe":"22","a k":"23","est":"24","ist":"25","ks ":"26","ta ":"27","al ":"28","ava":"29","id ":"30","saa":"31","mis":"32","te ":"33","val":"34"," et":"35","nud":"36"," te":"37","inn":"38"," se":"39"," tu":"40","a v":"41","alu":"42","e k":"43","ise":"44","lu ":"45","ma ":"46","mes":"47"," mi":"48","et ":"49","iku":"50","lin":"51","ad ":"52","el ":"53","ime":"54","ne ":"55","nna":"56"," ha":"57"," in":"58"," ke":"59"," võ":"60","a s":"61","a t":"62","ab ":"63","e s":"64","esi":"65"," la":"66"," li":"67","e v":"68","eks":"69","ema":"70","las":"71","les":"72","rju":"73","tle":"74","tsi":"75","tus":"76","upa":"77","use":"78","ust":"79","var":"80"," lä":"81","ali":"82","arj":"83","de ":"84","ete":"85","i t":"86","iga":"87","ilm":"88","kui":"89","li ":"90","tul":"91"," ei":"92"," me":"93"," sõ":"94","aal":"95","ata":"96","dus":"97","ei ":"98","nik":"99","pea":"100","s k":"101","s o":"102","sal":"103","sõn":"104","ter":"105","ul ":"106","või":"107"," el":"108"," ne":"109","a j":"110","ate":"111","end":"112","i k":"113","ita":"114","kar":"115","kor":"116","l o":"117","lt ":"118","maa":"119","oli":"120","sti":"121","vad":"122","ään":"123"," ju":"124"," jä":"125"," kü":"126"," ma":"127"," po":"128"," üt":"129","aas":"130","aks":"131","at ":"132","ed ":"133","eri":"134","hoi":"135","i s":"136","ka ":"137","la ":"138","nni":"139","oid":"140","pai":"141","rit":"142","us ":"143","ütl":"144"," aa":"145"," lo":"146"," to":"147"," ve":"148","a e":"149","ada":"150","aid":"151","ami":"152","and":"153","dla":"154","e j":"155","ega":"156","gi ":"157","gu ":"158","i p":"159","idl":"160","ik ":"161","ini":"162","jup":"163","kal":"164","kas":"165","kes":"166","koh":"167","s e":"168","s p":"169","sel":"170","sse":"171","ui ":"172"," pi":"173"," si":"174","aru":"175","eda":"176","eva":"177","fil":"178","i v":"179","ida":"180","ing":"181","lää":"182","me ":"183","na ":"184","nda":"185","nim":"186","ole":"187","ots":"188","ris":"189","s l":"190","sia":"191","t p":"192"," en":"193"," mu":"194"," ol":"195"," põ":"196"," su":"197"," vä":"198"," üh":"199","a l":"200","a p":"201","aga":"202","ale":"203","aps":"204","arv":"205","e a":"206","ela":"207","ika":"208","lle":"209","loo":"210","mal":"211","pet":"212","t k":"213","tee":"214","tis":"215","vat":"216","äne":"217","õnn":"218"," es":"219"," fi":"220"," vi":"221","a i":"222","a o":"223","aab":"224","aap":"225","ala":"226","alt":"227","ama":"228","anu":"229","e p":"230","e t":"231","eal":"232","eli":"233","haa":"234","hin":"235","iva":"236","kon":"237","ku ":"238","lik":"239","lm ":"240","min":"241","n t":"242","odu":"243","oon":"244","psa":"245","ri ":"246","si ":"247","stu":"248","t e":"249","t s":"250","ti ":"251","ule":"252","uur":"253","vas":"254","vee":"255"," ki":"256"," ni":"257"," nä":"258"," ra":"259","aig":"260","aka":"261","all":"262","atu":"263","e e":"264","eis":"265","ers":"266","i e":"267","ii ":"268","iis":"269","il ":"270","ima":"271","its":"272","kka":"273","kuh":"274","l k":"275","lat":"276","maj":"277","ndu":"278","ni ":"279","nii":"280","oma":"281","ool":"282","rso":"283","ru ":"284","rva":"285","s t":"286","sek":"287","son":"288","ste":"289","t m":"290","taj":"291","tam":"292","ude":"293","uho":"294","vai":"295"," ag":"296"," os":"297"," pa":"298"," re":"299"},"farsi":{"ان ":"0","ای ":"1","ه ا":"2"," اي":"3"," در":"4","به ":"5"," بر":"6","در ":"7","ران":"8"," به":"9","ی ا":"10","از ":"11","ين ":"12","می ":"13"," از":"14","ده ":"15","ست ":"16","است":"17"," اس":"18"," که":"19","که ":"20","اير":"21","ند ":"22","اين":"23"," ها":"24","يرا":"25","ود ":"26"," را":"27","های":"28"," خو":"29","ته ":"30","را ":"31","رای":"32","رد ":"33","ن ب":"34","کرد":"35"," و ":"36"," کر":"37","ات ":"38","برا":"39","د ک":"40","مان":"41","ی د":"42"," ان":"43","خوا":"44","شور":"45"," با":"46","ن ا":"47"," سا":"48","تمی":"49","ری ":"50","اتم":"51","ا ا":"52","واه":"53"," ات":"54"," عر":"55","اق ":"56","ر م":"57","راق":"58","عرا":"59","ی ب":"60"," تا":"61"," تو":"62","ار ":"63","ر ا":"64","ن م":"65","ه ب":"66","ور ":"67","يد ":"68","ی ک":"69"," ام":"70"," دا":"71"," کن":"72","اهد":"73","هد ":"74"," آن":"75"," می":"76"," ني":"77"," گف":"78","د ا":"79","گفت":"80"," کش":"81","ا ب":"82","نی ":"83","ها ":"84","کشو":"85"," رو":"86","ت ک":"87","نيو":"88","ه م":"89","وی ":"90","ی ت":"91"," شو":"92","ال ":"93","دار":"94","مه ":"95","ن ک":"96","ه د":"97","يه ":"98"," ما":"99","امه":"100","د ب":"101","زار":"102","ورا":"103","گزا":"104"," پي":"105","آن ":"106","انت":"107","ت ا":"108","فت ":"109","ه ن":"110","ی خ":"111","اما":"112","بات":"113","ما ":"114","ملل":"115","نام":"116","ير ":"117","ی م":"118","ی ه":"119"," آم":"120"," ای":"121"," من":"122","انس":"123","اني":"124","ت د":"125","رده":"126","ساز":"127","ن د":"128","نه ":"129","ورد":"130"," او":"131"," بي":"132"," سو":"133"," شد":"134","اده":"135","اند":"136","با ":"137","ت ب":"138","ر ب":"139","ز ا":"140","زما":"141","سته":"142","ن ر":"143","ه س":"144","وان":"145","وز ":"146","ی ر":"147","ی س":"148"," هس":"149","ابا":"150","ام ":"151","اور":"152","تخا":"153","خاب":"154","خود":"155","د د":"156","دن ":"157","رها":"158","روز":"159","رگز":"160","نتخ":"161","ه ش":"162","ه ه":"163","هست":"164","يت ":"165","يم ":"166"," دو":"167"," دي":"168"," مو":"169"," نو":"170"," هم":"171"," کا":"172","اد ":"173","اری":"174","انی":"175","بر ":"176","بود":"177","ت ه":"178","ح ه":"179","حال":"180","رش ":"181","عه ":"182","لی ":"183","وم ":"184","ژان":"185"," سل":"186","آمر":"187","اح ":"188","توس":"189","داد":"190","دام":"191","ر د":"192","ره ":"193","ريک":"194","زی ":"195","سلا":"196","شود":"197","لاح":"198","مري":"199","نند":"200","ه ع":"201","يما":"202","يکا":"203","پيم":"204","گر ":"205"," آژ":"206"," ال":"207"," بو":"208"," مق":"209"," مل":"210"," وی":"211","آژا":"212","ازم":"213","ازی":"214","بار":"215","برن":"216","ر آ":"217","ز س":"218","سعه":"219","شته":"220","مات":"221","ن آ":"222","ن پ":"223","نس ":"224","ه گ":"225","وسع":"226","يان":"227","يوم":"228","کا ":"229","کام":"230","کند":"231"," خا":"232"," سر":"233","آور":"234","ارد":"235","اقد":"236","ايم":"237","ايی":"238","برگ":"239","ت ع":"240","تن ":"241","خت ":"242","د و":"243","ر خ":"244","رک ":"245","زير":"246","فته":"247","قدا":"248","ل ت":"249","مين":"250","ن گ":"251","ه آ":"252","ه خ":"253","ه ک":"254","ورک":"255","ويو":"256","يور":"257","يوي":"258","يی ":"259","ک ت":"260","ی ش":"261"," اق":"262"," حا":"263"," حق":"264"," دس":"265"," شک":"266"," عم":"267"," يک":"268","ا ت":"269","ا د":"270","ارج":"271","بين":"272","ت م":"273","ت و":"274","تاي":"275","دست":"276","ر ح":"277","ر س":"278","رنا":"279","ز ب":"280","شکا":"281","لل ":"282","م ک":"283","مز ":"284","ندا":"285","نوا":"286","و ا":"287","وره":"288","ون ":"289","وند":"290","يمز":"291"," آو":"292"," اع":"293"," فر":"294"," مت":"295"," نه":"296"," هر":"297"," وز":"298"," گز":"299"},"finnish":{"en ":"0","in ":"1","an ":"2","on ":"3","ist":"4","ta ":"5","ja ":"6","n t":"7","sa ":"8","sta":"9","aan":"10","n p":"11"," on":"12","ssa":"13","tta":"14","tä ":"15"," ka":"16"," pa":"17","si ":"18"," ja":"19","n k":"20","lla":"21","än ":"22","een":"23","n v":"24","ksi":"25","ett":"26","nen":"27","taa":"28","ttä":"29"," va":"30","ill":"31","itt":"32"," jo":"33"," ko":"34","n s":"35"," tu":"36","ia ":"37"," su":"38","a p":"39","aa ":"40","la ":"41","lle":"42","n m":"43","le ":"44","tte":"45","na ":"46"," ta":"47"," ve":"48","at ":"49"," vi":"50","utt":"51"," sa":"52","ise":"53","sen":"54"," ku":"55"," nä":"56"," pä":"57","ste":"58"," ol":"59","a t":"60","ais":"61","maa":"62","ti ":"63","a o":"64","oit":"65","pää":"66"," pi":"67","a v":"68","ala":"69","ine":"70","isi":"71","tel":"72","tti":"73"," si":"74","a k":"75","all":"76","iin":"77","kin":"78","stä":"79","uom":"80","vii":"81"," ma":"82"," se":"83","enä":"84"," mu":"85","a s":"86","est":"87","iss":"88","llä":"89","lok":"90","lä ":"91","n j":"92","n o":"93","toi":"94","ven":"95","ytt":"96"," li":"97","ain":"98","et ":"99","ina":"100","n a":"101","n n":"102","oll":"103","plo":"104","ten":"105","ust":"106","äll":"107","ään":"108"," to":"109","den":"110","men":"111","oki":"112","suo":"113","sä ":"114","tää":"115","uks":"116","vat":"117"," al":"118"," ke":"119"," te":"120","a e":"121","lii":"122","tai":"123","tei":"124","äis":"125","ää ":"126"," pl":"127","ell":"128","i t":"129","ide":"130","ikk":"131","ki ":"132","nta":"133","ova":"134","yst":"135","yt ":"136","ä p":"137","äyt":"138"," ha":"139"," pe":"140"," tä":"141","a n":"142","aik":"143","i p":"144","i v":"145","nyt":"146","näy":"147","pal":"148","tee":"149","un ":"150"," me":"151","a m":"152","ess":"153","kau":"154","pai":"155","stu":"156","ut ":"157","voi":"158"," et":"159","a h":"160","eis":"161","hte":"162","i o":"163","iik":"164","ita":"165","jou":"166","mis":"167","nin":"168","nut":"169","sia":"170","ssä":"171","van":"172"," ty":"173"," yh":"174","aks":"175","ime":"176","loi":"177","me ":"178","n e":"179","n h":"180","n l":"181","oin":"182","ome":"183","ott":"184","ouk":"185","sit":"186","sti":"187","tet":"188","tie":"189","ukk":"190","ä k":"191"," ra":"192"," ti":"193","aja":"194","asi":"195","ent":"196","iga":"197","iig":"198","ite":"199","jan":"200","kaa":"201","kse":"202","laa":"203","lan":"204","li ":"205","näj":"206","ole":"207","tii":"208","usi":"209","äjä":"210"," ov":"211","a a":"212","ant":"213","ava":"214","ei ":"215","eri":"216","kan":"217","kku":"218","lai":"219","lis":"220","läi":"221","mat":"222","ois":"223","pel":"224","sil":"225","sty":"226","taj":"227","tav":"228","ttu":"229","työ":"230","yös":"231","ä o":"232"," ai":"233"," pu":"234","a j":"235","a l":"236","aal":"237","arv":"238","ass":"239","ien":"240","imi":"241","imm":"242","itä":"243","ka ":"244","kes":"245","kue":"246","lee":"247","lin":"248","llo":"249","one":"250","ri ":"251","t o":"252","t p":"253","tu ":"254","val":"255","vuo":"256"," ei":"257"," he":"258"," hy":"259"," my":"260"," vo":"261","ali":"262","alo":"263","ano":"264","ast":"265","att":"266","auk":"267","eli":"268","ely":"269","hti":"270","ika":"271","ken":"272","kki":"273","lys":"274","min":"275","myö":"276","oht":"277","oma":"278","tus":"279","umi":"280","yks":"281","ät ":"282","ääl":"283","ös ":"284"," ar":"285"," eu":"286"," hu":"287"," na":"288","aat":"289","alk":"290","alu":"291","ans":"292","arj":"293","enn":"294","han":"295","kuu":"296","n y":"297","set":"298","sim":"299"},"french":{"es ":"0"," de":"1","de ":"2"," le":"3","ent":"4","le ":"5","nt ":"6","la ":"7","s d":"8"," la":"9","ion":"10","on ":"11","re ":"12"," pa":"13","e l":"14","e d":"15"," l'":"16","e p":"17"," co":"18"," pr":"19","tio":"20","ns ":"21"," en":"22","ne ":"23","que":"24","r l":"25","les":"26","ur ":"27","en ":"28","ati":"29","ue ":"30"," po":"31"," d'":"32","par":"33"," a ":"34","et ":"35","it ":"36"," qu":"37","men":"38","ons":"39","te ":"40"," et":"41","t d":"42"," re":"43","des":"44"," un":"45","ie ":"46","s l":"47"," su":"48","pou":"49"," au":"50"," à ":"51","con":"52","er ":"53"," no":"54","ait":"55","e c":"56","se ":"57","té ":"58","du ":"59"," du":"60"," dé":"61","ce ":"62","e e":"63","is ":"64","n d":"65","s a":"66"," so":"67","e r":"68","e s":"69","our":"70","res":"71","ssi":"72","eur":"73"," se":"74","eme":"75","est":"76","us ":"77","sur":"78","ant":"79","iqu":"80","s p":"81","une":"82","uss":"83","l'a":"84","pro":"85","ter":"86","tre":"87","end":"88","rs ":"89"," ce":"90","e a":"91","t p":"92","un ":"93"," ma":"94"," ru":"95"," ré":"96","ous":"97","ris":"98","rus":"99","sse":"100","ans":"101","ar ":"102","com":"103","e m":"104","ire":"105","nce":"106","nte":"107","t l":"108"," av":"109"," mo":"110"," te":"111","il ":"112","me ":"113","ont":"114","ten":"115","a p":"116","dan":"117","pas":"118","qui":"119","s e":"120","s s":"121"," in":"122","ist":"123","lle":"124","nou":"125","pré":"126","'un":"127","air":"128","d'a":"129","ir ":"130","n e":"131","rop":"132","ts ":"133"," da":"134","a s":"135","as ":"136","au ":"137","den":"138","mai":"139","mis":"140","ori":"141","out":"142","rme":"143","sio":"144","tte":"145","ux ":"146","a d":"147","ien":"148","n a":"149","ntr":"150","omm":"151","ort":"152","ouv":"153","s c":"154","son":"155","tes":"156","ver":"157","ère":"158"," il":"159"," m ":"160"," sa":"161"," ve":"162","a r":"163","ais":"164","ava":"165","di ":"166","n p":"167","sti":"168","ven":"169"," mi":"170","ain":"171","enc":"172","for":"173","ité":"174","lar":"175","oir":"176","rem":"177","ren":"178","rro":"179","rés":"180","sie":"181","t a":"182","tur":"183"," pe":"184"," to":"185","d'u":"186","ell":"187","err":"188","ers":"189","ide":"190","ine":"191","iss":"192","mes":"193","por":"194","ran":"195","sit":"196","st ":"197","t r":"198","uti":"199","vai":"200","é l":"201","ési":"202"," di":"203"," n'":"204"," ét":"205","a c":"206","ass":"207","e t":"208","in ":"209","nde":"210","pre":"211","rat":"212","s m":"213","ste":"214","tai":"215","tch":"216","ui ":"217","uro":"218","ès ":"219"," es":"220"," fo":"221"," tr":"222","'ad":"223","app":"224","aux":"225","e à":"226","ett":"227","iti":"228","lit":"229","nal":"230","opé":"231","r d":"232","ra ":"233","rai":"234","ror":"235","s r":"236","tat":"237","uté":"238","à l":"239"," af":"240","anc":"241","ara":"242","art":"243","bre":"244","ché":"245","dre":"246","e f":"247","ens":"248","lem":"249","n r":"250","n t":"251","ndr":"252","nne":"253","onn":"254","pos":"255","s t":"256","tiq":"257","ure":"258"," tu":"259","ale":"260","and":"261","ave":"262","cla":"263","cou":"264","e n":"265","emb":"266","ins":"267","jou":"268","mme":"269","rie":"270","rès":"271","sem":"272","str":"273","t i":"274","ues":"275","uni":"276","uve":"277","é d":"278","ée ":"279"," ch":"280"," do":"281"," eu":"282"," fa":"283"," lo":"284"," ne":"285"," ra":"286","arl":"287","att":"288","ec ":"289","ica":"290","l a":"291","l'o":"292","l'é":"293","mmi":"294","nta":"295","orm":"296","ou ":"297","r u":"298","rle":"299"},"german":{"en ":"0","er ":"1"," de":"2","der":"3","ie ":"4"," di":"5","die":"6","sch":"7","ein":"8","che":"9","ich":"10","den":"11","in ":"12","te ":"13","ch ":"14"," ei":"15","ung":"16","n d":"17","nd ":"18"," be":"19","ver":"20","es ":"21"," zu":"22","eit":"23","gen":"24","und":"25"," un":"26"," au":"27"," in":"28","cht":"29","it ":"30","ten":"31"," da":"32","ent":"33"," ve":"34","and":"35"," ge":"36","ine":"37"," mi":"38","r d":"39","hen":"40","ng ":"41","nde":"42"," vo":"43","e d":"44","ber":"45","men":"46","ei ":"47","mit":"48"," st":"49","ter":"50","ren":"51","t d":"52"," er":"53","ere":"54","n s":"55","ste":"56"," se":"57","e s":"58","ht ":"59","des":"60","ist":"61","ne ":"62","auf":"63","e a":"64","isc":"65","on ":"66","rte":"67"," re":"68"," we":"69","ges":"70","uch":"71"," fü":"72"," so":"73","bei":"74","e e":"75","nen":"76","r s":"77","ach":"78","für":"79","ier":"80","par":"81","ür ":"82"," ha":"83","as ":"84","ert":"85"," an":"86"," pa":"87"," sa":"88"," sp":"89"," wi":"90","for":"91","tag":"92","zu ":"93","das":"94","rei":"95","he ":"96","hre":"97","nte":"98","sen":"99","vor":"100"," sc":"101","ech":"102","etz":"103","hei":"104","lan":"105","n a":"106","pd ":"107","st ":"108","sta":"109","ese":"110","lic":"111"," ab":"112"," si":"113","gte":"114"," wa":"115","iti":"116","kei":"117","n e":"118","nge":"119","sei":"120","tra":"121","zen":"122"," im":"123"," la":"124","art":"125","im ":"126","lle":"127","n w":"128","rde":"129","rec":"130","set":"131","str":"132","tei":"133","tte":"134"," ni":"135","e p":"136","ehe":"137","ers":"138","g d":"139","nic":"140","von":"141"," al":"142"," pr":"143","an ":"144","aus":"145","erf":"146","r e":"147","tze":"148","tür":"149","uf ":"150","ag ":"151","als":"152","ar ":"153","chs":"154","end":"155","ge ":"156","ige":"157","ion":"158","ls ":"159","n m":"160","ngs":"161","nis":"162","nt ":"163","ord":"164","s s":"165","sse":"166"," tü":"167","ahl":"168","e b":"169","ede":"170","em ":"171","len":"172","n i":"173","orm":"174","pro":"175","rke":"176","run":"177","s d":"178","wah":"179","wer":"180","ürk":"181"," me":"182","age":"183","att":"184","ell":"185","est":"186","hat":"187","n b":"188","oll":"189","raf":"190","s a":"191","tsc":"192"," es":"193"," fo":"194"," gr":"195"," ja":"196","abe":"197","auc":"198","ben":"199","e n":"200","ege":"201","lie":"202","n u":"203","r v":"204","re ":"205","rit":"206","sag":"207"," am":"208","agt":"209","ahr":"210","bra":"211","de ":"212","erd":"213","her":"214","ite":"215","le ":"216","n p":"217","n v":"218","or ":"219","rbe":"220","rt ":"221","sic":"222","wie":"223","übe":"224"," is":"225"," üb":"226","cha":"227","chi":"228","e f":"229","e m":"230","eri":"231","ied":"232","mme":"233","ner":"234","r a":"235","sti":"236","t a":"237","t s":"238","tis":"239"," ko":"240","arb":"241","ds ":"242","gan":"243","n z":"244","r f":"245","r w":"246","ran":"247","se ":"248","t i":"249","wei":"250","wir":"251"," br":"252"," np":"253","am ":"254","bes":"255","d d":"256","deu":"257","e g":"258","e k":"259","efo":"260","et ":"261","eut":"262","fen":"263","hse":"264","lte":"265","n r":"266","npd":"267","r b":"268","rhe":"269","t w":"270","tz ":"271"," fr":"272"," ih":"273"," ke":"274"," ma":"275","ame":"276","ang":"277","d s":"278","eil":"279","el ":"280","era":"281","erh":"282","h d":"283","i d":"284","kan":"285","n f":"286","n l":"287","nts":"288","och":"289","rag":"290","rd ":"291","spd":"292","spr":"293","tio":"294"," ar":"295"," en":"296"," ka":"297","ark":"298","ass":"299"},"hausa":{" da":"0","da ":"1","in ":"2","an ":"3","ya ":"4"," wa":"5"," ya":"6","na ":"7","ar ":"8","a d":"9"," ma":"10","wa ":"11","a a":"12","a k":"13","a s":"14"," ta":"15","wan":"16"," a ":"17"," ba":"18"," ka":"19","ta ":"20","a y":"21","n d":"22"," ha":"23"," na":"24"," su":"25"," sa":"26","kin":"27","sa ":"28","ata":"29"," ko":"30","a t":"31","su ":"32"," ga":"33","ai ":"34"," sh":"35","a m":"36","uwa":"37","iya":"38","ma ":"39","a w":"40","asa":"41","yan":"42","ka ":"43","ani":"44","shi":"45","a b":"46","a h":"47","a c":"48","ama":"49","ba ":"50","nan":"51","n a":"52"," mu":"53","ana":"54"," yi":"55","a g":"56"," za":"57","i d":"58"," ku":"59","aka":"60","yi ":"61","n k":"62","ann":"63","ke ":"64","tar":"65"," ci":"66","iki":"67","n s":"68","ko ":"69"," ra":"70","ki ":"71","ne ":"72","a z":"73","mat":"74","hak":"75","nin":"76","e d":"77","nna":"78","uma":"79","nda":"80","a n":"81","ada":"82","cik":"83","ni ":"84","rin":"85","una":"86","ara":"87","kum":"88","akk":"89"," ce":"90"," du":"91","man":"92","n y":"93","nci":"94","sar":"95","aki":"96","awa":"97","ci ":"98","kan":"99","kar":"100","ari":"101","n m":"102","and":"103","hi ":"104","n t":"105","ga ":"106","owa":"107","ash":"108","kam":"109","dan":"110","ewa":"111","nsa":"112","ali":"113","ami":"114"," ab":"115"," do":"116","anc":"117","n r":"118","aya":"119","i n":"120","sun":"121","uka":"122"," al":"123"," ne":"124","a'a":"125","cew":"126","cin":"127","mas":"128","tak":"129","un ":"130","aba":"131","kow":"132","a r":"133","ra ":"134"," ja":"135"," ƙa":"136","en ":"137","r d":"138","sam":"139","tsa":"140"," ru":"141","ce ":"142","i a":"143","abi":"144","ida":"145","mut":"146","n g":"147","n j":"148","san":"149","a ƙ":"150","har":"151","on ":"152","i m":"153","suk":"154"," ak":"155"," ji":"156","yar":"157","'ya":"158","kwa":"159","min":"160"," 'y":"161","ane":"162","ban":"163","ins":"164","ruw":"165","i k":"166","n h":"167"," ad":"168","ake":"169","n w":"170","sha":"171","utu":"172"," ƴa":"173","bay":"174","tan":"175","ƴan":"176","bin":"177","duk":"178","e m":"179","n n":"180","oka":"181","yin":"182","ɗan":"183"," fa":"184","a i":"185","kki":"186","re ":"187","za ":"188","ala":"189","asu":"190","han":"191","i y":"192","mar":"193","ran":"194","ƙas":"195","add":"196","ars":"197","gab":"198","ira":"199","mma":"200","u d":"201"," ts":"202","abb":"203","abu":"204","aga":"205","gar":"206","n b":"207"," ɗa":"208","aci":"209","aik":"210","am ":"211","dun":"212","e s":"213","i b":"214","i w":"215","kas":"216","kok":"217","wam":"218"," am":"219","amf":"220","bba":"221","din":"222","fan":"223","gwa":"224","i s":"225","wat":"226","ano":"227","are":"228","dai":"229","iri":"230","ma'":"231"," la":"232","all":"233","dam":"234","ika":"235","mi ":"236","she":"237","tum":"238","uni":"239"," an":"240"," ai":"241"," ke":"242"," ki":"243","dag":"244","mai":"245","mfa":"246","no ":"247","nsu":"248","o d":"249","sak":"250","um ":"251"," bi":"252"," gw":"253"," kw":"254","jam":"255","yya":"256","a j":"257","fa ":"258","uta":"259"," hu":"260","'a ":"261","ans":"262","aɗa":"263","dda":"264","hin":"265","niy":"266","r s":"267","bat":"268","dar":"269","gan":"270","i t":"271","nta":"272","oki":"273","omi":"274","sal":"275","a l":"276","kac":"277","lla":"278","wad":"279","war":"280","amm":"281","dom":"282","r m":"283","ras":"284","sai":"285"," lo":"286","ats":"287","hal":"288","kat":"289","li ":"290","lok":"291","n c":"292","nar":"293","tin":"294","afa":"295","bub":"296","i g":"297","isa":"298","mak":"299"},"hawaiian":{" ka":"0","na ":"1"," o ":"2","ka ":"3"," ma":"4"," a ":"5"," la":"6","a i":"7","a m":"8"," i ":"9","la ":"10","ana":"11","ai ":"12","ia ":"13","a o":"14","a k":"15","a h":"16","o k":"17"," ke":"18","a a":"19","i k":"20"," ho":"21"," ia":"22","ua ":"23"," na":"24"," me":"25","e k":"26","e a":"27","au ":"28","ke ":"29","ma ":"30","mai":"31","aku":"32"," ak":"33","ahi":"34"," ha":"35"," ko":"36"," e ":"37","a l":"38"," no":"39","me ":"40","ku ":"41","aka":"42","kan":"43","no ":"44","i a":"45","ho ":"46","ou ":"47"," ai":"48","i o":"49","a p":"50","o l":"51","o a":"52","ama":"53","a n":"54"," an":"55","i m":"56","han":"57","i i":"58","iho":"59","kou":"60","ne ":"61"," ih":"62","o i":"63","iki":"64","ona":"65","hoo":"66","le ":"67","e h":"68"," he":"69","ina":"70"," wa":"71","ea ":"72","ako":"73","u i":"74","kah":"75","oe ":"76","i l":"77","u a":"78"," pa":"79","hoi":"80","e i":"81","era":"82","ko ":"83","u m":"84","kua":"85","mak":"86","oi ":"87","kai":"88","i n":"89","a e":"90","hin":"91","ane":"92"," ol":"93","i h":"94","mea":"95","wah":"96","lak":"97","e m":"98","o n":"99","u l":"100","ika":"101","ki ":"102","a w":"103","mal":"104","hi ":"105","e n":"106","u o":"107","hik":"108"," ku":"109","e l":"110","ele":"111","ra ":"112","ber":"113","ine":"114","abe":"115","ain":"116","ala":"117","lo ":"118"," po":"119","kon":"120"," ab":"121","ole":"122","he ":"123","pau":"124","mah":"125","va ":"126","ela":"127","kau":"128","nak":"129"," oe":"130","kei":"131","oia":"132"," ie":"133","ram":"134"," oi":"135","oa ":"136","eho":"137","hov":"138","ieh":"139","ova":"140"," ua":"141","una":"142","ara":"143","o s":"144","awa":"145","o o":"146","nau":"147","u n":"148","wa ":"149","wai":"150","hel":"151"," ae":"152"," al":"153","ae ":"154","ta ":"155","aik":"156"," hi":"157","ale":"158","ila":"159","lel":"160","ali":"161","eik":"162","olo":"163","onu":"164"," lo":"165","aua":"166","e o":"167","ola":"168","hon":"169","mam":"170","nan":"171"," au":"172","aha":"173","lau":"174","nua":"175","oho":"176","oma":"177"," ao":"178","ii ":"179","alu":"180","ima":"181","mau":"182","ike":"183","apa":"184","elo":"185","lii":"186","poe":"187","aia":"188","noa":"189"," in":"190","o m":"191","oka":"192","'u ":"193","aho":"194","ei ":"195","eka":"196","ha ":"197","lu ":"198","nei":"199","hol":"200","ino":"201","o e":"202","ema":"203","iwa":"204","olu":"205","ada":"206","naa":"207","pa ":"208","u k":"209","ewa":"210","hua":"211","lam":"212","lua":"213","o h":"214","ook":"215","u h":"216"," li":"217","ahu":"218","amu":"219","ui ":"220"," il":"221"," mo":"222"," se":"223","eia":"224","law":"225"," hu":"226"," ik":"227","ail":"228","e p":"229","li ":"230","lun":"231","uli":"232","io ":"233","kik":"234","noh":"235","u e":"236"," sa":"237","aaw":"238","awe":"239","ena":"240","hal":"241","kol":"242","lan":"243"," le":"244"," ne":"245","a'u":"246","ilo":"247","kap":"248","oko":"249","sa ":"250"," pe":"251","hop":"252","loa":"253","ope":"254","pe ":"255"," ad":"256"," pu":"257","ahe":"258","aol":"259","ia'":"260","lai":"261","loh":"262","na'":"263","oom":"264","aau":"265","eri":"266","kul":"267","we ":"268","ake":"269","kek":"270","laa":"271","ri ":"272","iku":"273","kak":"274","lim":"275","nah":"276","ner":"277","nui":"278","ono":"279","a u":"280","dam":"281","kum":"282","lok":"283","mua":"284","uma":"285","wal":"286","wi ":"287","'i ":"288","a'i":"289","aan":"290","alo":"291","eta":"292","mu ":"293","ohe":"294","u p":"295","ula":"296","uwa":"297"," nu":"298","amo":"299"},"hindi":{"ें ":"0"," है":"1","में":"2"," मे":"3","ने ":"4","की ":"5","के ":"6","है ":"7"," के":"8"," की":"9"," को":"10","ों ":"11","को ":"12","ा ह":"13"," का":"14","से ":"15","ा क":"16","े क":"17","ं क":"18","या ":"19"," कि":"20"," से":"21","का ":"22","ी क":"23"," ने":"24"," और":"25","और ":"26","ना ":"27","कि ":"28","भी ":"29","ी स":"30"," जा":"31"," पर":"32","ार ":"33"," कर":"34","ी ह":"35"," हो":"36","ही ":"37","िया":"38"," इस":"39"," रह":"40","र क":"41","ुना":"42","ता ":"43","ान ":"44","े स":"45"," भी":"46"," रा":"47","े ह":"48"," चु":"49"," पा":"50","पर ":"51","चुन":"52","नाव":"53"," कह":"54","प्र":"55"," भा":"56","राज":"57","हैं":"58","ा स":"59","ै क":"60","ैं ":"61","नी ":"62","ल क":"63","ीं ":"64","़ी ":"65","था ":"66","री ":"67","ाव ":"68","े ब":"69"," प्":"70","क्ष":"71","पा ":"72","ले ":"73"," दे":"74","ला ":"75","हा ":"76","ाजप":"77"," था":"78"," नह":"79","इस ":"80","कर ":"81","जपा":"82","नही":"83","भाज":"84","यों":"85","र स":"86","हीं":"87"," अम":"88"," बा":"89"," मा":"90"," वि":"91","रीक":"92","िए ":"93","े प":"94","्या":"95"," ही":"96","ं म":"97","कार":"98","ा ज":"99","े ल":"100"," ता":"101"," दि":"102"," सा":"103"," हम":"104","ा न":"105","ा म":"106","ाक़":"107","्ता":"108"," एक":"109"," सं":"110"," स्":"111","अमर":"112","क़ी":"113","ताज":"114","मरी":"115","स्थ":"116","ा थ":"117","ार्":"118"," हु":"119","इरा":"120","एक ":"121","न क":"122","र म":"123","राक":"124","ी ज":"125","ी न":"126"," इर":"127"," उन":"128"," पह":"129","कहा":"130","ते ":"131","े अ":"132"," तो":"133"," सु":"134","ति ":"135","ती ":"136","तो ":"137","मिल":"138","िक ":"139","ियो":"140","्रे":"141"," अप":"142"," फ़":"143"," लि":"144"," लो":"145"," सम":"146","म क":"147","र्ट":"148","हो ":"149","ा च":"150","ाई ":"151","ाने":"152","िन ":"153","्य ":"154"," उस":"155"," क़":"156"," सक":"157"," सै":"158","ं प":"159","ं ह":"160","गी ":"161","त क":"162","मान":"163","र न":"164","ष्ट":"165","स क":"166","स्त":"167","ाँ ":"168","ी ब":"169","ी म":"170","्री":"171"," दो":"172"," मि":"173"," मु":"174"," ले":"175"," शा":"176","ं स":"177","ज़ा":"178","त्र":"179","थी ":"180","लिए":"181","सी ":"182","़ा ":"183","़ार":"184","ांग":"185","े द":"186","े म":"187","्व ":"188"," ना":"189"," बन":"190","ंग्":"191","कां":"192","गा ":"193","ग्र":"194","जा ":"195","ज्य":"196","दी ":"197","न म":"198","पार":"199","भा ":"200","रही":"201","रे ":"202","रेस":"203","ली ":"204","सभा":"205","ा र":"206","ाल ":"207","ी अ":"208","ीकी":"209","े त":"210","ेश ":"211"," अं":"212"," तक":"213"," या":"214","ई ह":"215","करन":"216","तक ":"217","देश":"218","वर्":"219","ाया":"220","ी भ":"221","ेस ":"222","्ष ":"223"," गय":"224"," जि":"225"," थी":"226"," बड":"227"," यह":"228"," वा":"229","ंतर":"230","अंत":"231","क़ ":"232","गया":"233","टी ":"234","निक":"235","न्ह":"236","पहल":"237","बड़":"238","मार":"239","र प":"240","रने":"241","ाज़":"242","ि इ":"243","ी र":"244","े ज":"245","े व":"246","्ट ":"247","्टी":"248"," अब":"249"," लग":"250"," वर":"251"," सी":"252","ं भ":"253","उन्":"254","क क":"255","किय":"256","देख":"257","पूर":"258","फ़्":"259","यह ":"260","यान":"261","रिक":"262","रिय":"263","र्ड":"264","लेक":"265","सकत":"266","हों":"267","होग":"268","ा अ":"269","ा द":"270","ा प":"271","ाद ":"272","ारा":"273","ित ":"274","ी त":"275","ी प":"276","ो क":"277","ो द":"278"," ते":"279"," नि":"280"," सर":"281"," हा":"282","ं द":"283","अपन":"284","जान":"285","त म":"286","थित":"287","पनी":"288","महल":"289","र ह":"290","लोग":"291","व क":"292","हना":"293","हल ":"294","हाँ":"295","ाज्":"296","ाना":"297","िक्":"298","िस्":"299"},"hungarian":{" a ":"0"," az":"1"," sz":"2","az ":"3"," me":"4","en ":"5"," el":"6"," ho":"7","ek ":"8","gy ":"9","tt ":"10","ett":"11","sze":"12"," fe":"13","és ":"14"," ki":"15","tet":"16"," be":"17","et ":"18","ter":"19"," kö":"20"," és":"21","hog":"22","meg":"23","ogy":"24","szt":"25","te ":"26","t a":"27","zet":"28","a m":"29","nek":"30","nt ":"31","ség":"32","szá":"33","ak ":"34"," va":"35","an ":"36","eze":"37","ra ":"38","ta ":"39"," mi":"40","int":"41","köz":"42"," is":"43","esz":"44","fel":"45","min":"46","nak":"47","ors":"48","zer":"49"," te":"50","a a":"51","a k":"52","is ":"53"," cs":"54","ele":"55","er ":"56","men":"57","si ":"58","tek":"59","ti ":"60"," ne":"61","csa":"62","ent":"63","z e":"64","a t":"65","ala":"66","ere":"67","es ":"68","lom":"69","lte":"70","mon":"71","ond":"72","rsz":"73","sza":"74","tte":"75","zág":"76","ány":"77"," fo":"78"," ma":"79","ai ":"80","ben":"81","el ":"82","ene":"83","ik ":"84","jel":"85","tás":"86","áll":"87"," ha":"88"," le":"89"," ál":"90","agy":"91","alá":"92","isz":"93","y a":"94","zte":"95","ás ":"96"," al":"97","e a":"98","egy":"99","ely":"100","for":"101","lat":"102","lt ":"103","n a":"104","oga":"105","on ":"106","re ":"107","st ":"108","ság":"109","t m":"110","án ":"111","ét ":"112","ült":"113"," je":"114","gi ":"115","k a":"116","kül":"117","lam":"118","len":"119","lás":"120","más":"121","s k":"122","vez":"123","áso":"124","özö":"125"," ta":"126","a s":"127","a v":"128","asz":"129","atá":"130","ető":"131","kez":"132","let":"133","mag":"134","nem":"135","szé":"136","z m":"137","át ":"138","éte":"139","ölt":"140"," de":"141"," gy":"142"," ké":"143"," mo":"144"," vá":"145"," ér":"146","a b":"147","a f":"148","ami":"149","at ":"150","ato":"151","att":"152","bef":"153","dta":"154","gya":"155","hat":"156","i s":"157","las":"158","ndt":"159","rt ":"160","szo":"161","t k":"162","tár":"163","tés":"164","van":"165","ásá":"166","ól ":"167"," bé":"168"," eg":"169"," or":"170"," pá":"171"," pé":"172"," ve":"173","ban":"174","eke":"175","ekü":"176","elő":"177","erv":"178","ete":"179","fog":"180","i a":"181","kis":"182","lád":"183","nte":"184","nye":"185","nyi":"186","ok ":"187","omá":"188","os ":"189","rán":"190","rás":"191","sal":"192","t e":"193","vál":"194","yar":"195","ágo":"196","ála":"197","ége":"198","ény":"199","ött":"200"," tá":"201","adó":"202","elh":"203","fej":"204","het":"205","hoz":"206","ill":"207","jár":"208","kés":"209","llo":"210","mi ":"211","ny ":"212","ont":"213","ren":"214","res":"215","rin":"216","s a":"217","s e":"218","ssz":"219","zt ":"220"," ez":"221"," ka":"222"," ke":"223"," ko":"224"," re":"225","a h":"226","a n":"227","den":"228","dó ":"229","efo":"230","gad":"231","gat":"232","gye":"233","hel":"234","k e":"235","ket":"236","les":"237","mán":"238","nde":"239","nis":"240","ozz":"241","t b":"242","t i":"243","t é":"244","tat":"245","tos":"246","val":"247","z o":"248","zak":"249","ád ":"250","ály":"251","ára":"252","ési":"253","ész":"254"," ak":"255"," am":"256"," es":"257"," há":"258"," ny":"259"," tö":"260","aka":"261","art":"262","ató":"263","azt":"264","bbe":"265","ber":"266","ció":"267","cso":"268","em ":"269","eti":"270","eté":"271","gal":"272","i t":"273","ini":"274","ist":"275","ja ":"276","ker":"277","ki ":"278","kor":"279","koz":"280","l é":"281","ljá":"282","lye":"283","n v":"284","ni ":"285","pál":"286","ror":"287","ról":"288","rül":"289","s c":"290","s p":"291","s s":"292","s v":"293","sok":"294","t j":"295","t t":"296","tar":"297","tel":"298","vat":"299"},"icelandic":{"að ":"0","um ":"1"," að":"2","ir ":"3","ið ":"4","ur ":"5"," ve":"6"," í ":"7","na ":"8"," á ":"9"," se":"10"," er":"11"," og":"12","ar ":"13","og ":"14","ver":"15"," mi":"16","inn":"17","nn ":"18"," fy":"19","er ":"20","fyr":"21"," ek":"22"," en":"23"," ha":"24"," he":"25","ekk":"26"," st":"27","ki ":"28","st ":"29","ði ":"30"," ba":"31"," me":"32"," vi":"33","ig ":"34","rir":"35","yri":"36"," um":"37","g f":"38","leg":"39","lei":"40","ns ":"41","ð s":"42"," ei":"43"," þa":"44","in ":"45","kki":"46","r h":"47","r s":"48","egi":"49","ein":"50","ga ":"51","ing":"52","ra ":"53","sta":"54"," va":"55"," þe":"56","ann":"57","en ":"58","mil":"59","sem":"60","tjó":"61","arð":"62","di ":"63","eit":"64","haf":"65","ill":"66","ins":"67","ist":"68","llj":"69","ndi":"70","r a":"71","r e":"72","seg":"73","un ":"74","var":"75"," bi":"76"," el":"77"," fo":"78"," ge":"79"," yf":"80","and":"81","aug":"82","bau":"83","big":"84","ega":"85","eld":"86","erð":"87","fir":"88","foo":"89","gin":"90","itt":"91","n s":"92","ngi":"93","num":"94","od ":"95","ood":"96","sin":"97","ta ":"98","tt ":"99","við":"100","yfi":"101","ð e":"102","ð f":"103"," hr":"104"," sé":"105"," þv":"106","a e":"107","a á":"108","em ":"109","gi ":"110","i f":"111","jar":"112","jór":"113","lja":"114","m e":"115","r á":"116","rei":"117","rst":"118","rða":"119","rði":"120","rðu":"121","stj":"122","und":"123","veg":"124","ví ":"125","ð v":"126","það":"127","því":"128"," fj":"129"," ko":"130"," sl":"131","eik":"132","end":"133","ert":"134","ess":"135","fjá":"136","fur":"137","gir":"138","hús":"139","jár":"140","n e":"141","ri ":"142","tar":"143","ð þ":"144","ðar":"145","ður":"146","þes":"147"," br":"148"," hú":"149"," kr":"150"," le":"151"," up":"152","a s":"153","egg":"154","i s":"155","irt":"156","ja ":"157","kið":"158","len":"159","með":"160","mik":"161","n b":"162","nar":"163","nir":"164","nun":"165","r f":"166","r v":"167","rið":"168","rt ":"169","sti":"170","t v":"171","ti ":"172","una":"173","upp":"174","ða ":"175","óna":"176"," al":"177"," fr":"178"," gr":"179","a v":"180","all":"181","an ":"182","da ":"183","eið":"184","eð ":"185","fa ":"186","fra":"187","g e":"188","ger":"189","gið":"190","gt ":"191","han":"192","hef":"193","hel":"194","her":"195","hra":"196","i a":"197","i e":"198","i v":"199","i þ":"200","iki":"201","jón":"202","jör":"203","ka ":"204","kró":"205","lík":"206","m h":"207","n a":"208","nga":"209","r l":"210","ram":"211","ru ":"212","ráð":"213","rón":"214","svo":"215","vin":"216","í b":"217","í h":"218","ð h":"219","ð k":"220","ð m":"221","örð":"222"," af":"223"," fa":"224"," lí":"225"," rá":"226"," sk":"227"," sv":"228"," te":"229","a b":"230","a f":"231","a h":"232","a k":"233","a u":"234","afi":"235","agn":"236","arn":"237","ast":"238","ber":"239","efu":"240","enn":"241","erb":"242","erg":"243","fi ":"244","g a":"245","gar":"246","iðs":"247","ker":"248","kke":"249","lan":"250","ljó":"251","llt":"252","ma ":"253","mið":"254","n v":"255","n í":"256","nan":"257","nda":"258","ndu":"259","nið":"260","nna":"261","nnu":"262","nu ":"263","r o":"264","rbe":"265","rgi":"266","slö":"267","sé ":"268","t a":"269","t h":"270","til":"271","tin":"272","ugu":"273","vil":"274","ygg":"275","á s":"276","ð a":"277","ð b":"278","órn":"279","ögn":"280","öku":"281"," at":"282"," fi":"283"," fé":"284"," ka":"285"," ma":"286"," no":"287"," sa":"288"," si":"289"," ti":"290"," ák":"291","a m":"292","a t":"293","a í":"294","a þ":"295","afa":"296","afs":"297","ald":"298","arf":"299"},"indonesian":{"an ":"0"," me":"1","kan":"2","ang":"3","ng ":"4"," pe":"5","men":"6"," di":"7"," ke":"8"," da":"9"," se":"10","eng":"11"," be":"12","nga":"13","nya":"14"," te":"15","ah ":"16","ber":"17","aka":"18"," ya":"19","dan":"20","di ":"21","yan":"22","n p":"23","per":"24","a m":"25","ita":"26"," pa":"27","da ":"28","ata":"29","ada":"30","ya ":"31","ta ":"32"," in":"33","ala":"34","eri":"35","ia ":"36","a d":"37","n k":"38","am ":"39","ga ":"40","at ":"41","era":"42","n d":"43","ter":"44"," ka":"45","a p":"46","ari":"47","emb":"48","n m":"49","ri ":"50"," ba":"51","aan":"52","ak ":"53","ra ":"54"," it":"55","ara":"56","ela":"57","ni ":"58","ali":"59","ran":"60","ar ":"61","eru":"62","lah":"63","a b":"64","asi":"65","awa":"66","eba":"67","gan":"68","n b":"69"," ha":"70","ini":"71","mer":"72"," la":"73"," mi":"74","and":"75","ena":"76","wan":"77"," sa":"78","aha":"79","lam":"80","n i":"81","nda":"82"," wa":"83","a i":"84","dua":"85","g m":"86","mi ":"87","n a":"88","rus":"89","tel":"90","yak":"91"," an":"92","dal":"93","h d":"94","i s":"95","ing":"96","min":"97","ngg":"98","tak":"99","ami":"100","beb":"101","den":"102","gat":"103","ian":"104","ih ":"105","pad":"106","rga":"107","san":"108","ua ":"109"," de":"110","a t":"111","arg":"112","dar":"113","elu":"114","har":"115","i k":"116","i m":"117","i p":"118","ika":"119","in ":"120","iny":"121","itu":"122","mba":"123","n t":"124","ntu":"125","pan":"126","pen":"127","sah":"128","tan":"129","tu ":"130","a k":"131","ban":"132","edu":"133","eka":"134","g d":"135","ka ":"136","ker":"137","nde":"138","nta":"139","ora":"140","usa":"141"," du":"142"," ma":"143","a s":"144","ai ":"145","ant":"146","bas":"147","end":"148","i d":"149","ira":"150","kam":"151","lan":"152","n s":"153","uli":"154","al ":"155","apa":"156","ere":"157","ert":"158","lia":"159","mem":"160","rka":"161","si ":"162","tal":"163","ung":"164"," ak":"165","a a":"166","a w":"167","ani":"168","ask":"169","ent":"170","gar":"171","haa":"172","i i":"173","isa":"174","ked":"175","mbe":"176","ska":"177","tor":"178","uan":"179","uk ":"180","uka":"181"," ad":"182"," to":"183","asa":"184","aya":"185","bag":"186","dia":"187","dun":"188","erj":"189","mas":"190","na ":"191","rek":"192","rit":"193","sih":"194","us ":"195"," bi":"196","a h":"197","ama":"198","dib":"199","ers":"200","g s":"201","han":"202","ik ":"203","kem":"204","ma ":"205","n l":"206","nit":"207","r b":"208","rja":"209","sa ":"210"," ju":"211"," or":"212"," si":"213"," ti":"214","a y":"215","aga":"216","any":"217","as ":"218","cul":"219","eme":"220","emu":"221","eny":"222","epa":"223","erb":"224","erl":"225","gi ":"226","h m":"227","i a":"228","kel":"229","li ":"230","mel":"231","nia":"232","opa":"233","rta":"234","sia":"235","tah":"236","ula":"237","un ":"238","unt":"239"," at":"240"," bu":"241"," pu":"242"," ta":"243","agi":"244","alu":"245","amb":"246","bah":"247","bis":"248","er ":"249","i t":"250","ibe":"251","ir ":"252","ja ":"253","k m":"254","kar":"255","lai":"256","lal":"257","lu ":"258","mpa":"259","ngk":"260","nja":"261","or ":"262","pa ":"263","pas":"264","pem":"265","rak":"266","rik":"267","seb":"268","tam":"269","tem":"270","top":"271","tuk":"272","uni":"273","war":"274"," al":"275"," ga":"276"," ge":"277"," ir":"278"," ja":"279"," mu":"280"," na":"281"," pr":"282"," su":"283"," un":"284","ad ":"285","adi":"286","akt":"287","ann":"288","apo":"289","bel":"290","bul":"291","der":"292","ega":"293","eke":"294","ema":"295","emp":"296","ene":"297","enj":"298","esa":"299"},"italian":{" di":"0","to ":"1","la ":"2"," de":"3","di ":"4","no ":"5"," co":"6","re ":"7","ion":"8","e d":"9"," e ":"10","le ":"11","del":"12","ne ":"13","ti ":"14","ell":"15"," la":"16"," un":"17","ni ":"18","i d":"19","per":"20"," pe":"21","ent":"22"," in":"23","one":"24","he ":"25","ta ":"26","zio":"27","che":"28","o d":"29","a d":"30","na ":"31","ato":"32","e s":"33"," so":"34","i s":"35","lla":"36","a p":"37","li ":"38","te ":"39"," al":"40"," ch":"41","er ":"42"," pa":"43"," si":"44","con":"45","sta":"46"," pr":"47","a c":"48"," se":"49","el ":"50","ia ":"51","si ":"52","e p":"53"," da":"54","e i":"55","i p":"56","ont":"57","ano":"58","i c":"59","all":"60","azi":"61","nte":"62","on ":"63","nti":"64","o s":"65"," ri":"66","i a":"67","o a":"68","un ":"69"," an":"70","are":"71","ari":"72","e a":"73","i e":"74","ita":"75","men":"76","ri ":"77"," ca":"78"," il":"79"," no":"80"," po":"81","a s":"82","ant":"83","il ":"84","in ":"85","a l":"86","ati":"87","cia":"88","e c":"89","ro ":"90","ann":"91","est":"92","gli":"93","tà ":"94"," qu":"95","e l":"96","nta":"97"," a ":"98","com":"99","o c":"100","ra ":"101"," le":"102"," ne":"103","ali":"104","ere":"105","ist":"106"," ma":"107"," è ":"108","io ":"109","lle":"110","me ":"111","era":"112","ica":"113","ost":"114","pro":"115","tar":"116","una":"117"," pi":"118","da ":"119","tat":"120"," mi":"121","att":"122","ca ":"123","mo ":"124","non":"125","par":"126","sti":"127"," fa":"128"," i ":"129"," re":"130"," su":"131","ess":"132","ini":"133","nto":"134","o l":"135","ssi":"136","tto":"137","a e":"138","ame":"139","col":"140","ei ":"141","ma ":"142","o i":"143","za ":"144"," st":"145","a a":"146","ale":"147","anc":"148","ani":"149","i m":"150","ian":"151","o p":"152","oni":"153","sio":"154","tan":"155","tti":"156"," lo":"157","i r":"158","oci":"159","oli":"160","ona":"161","ono":"162","tra":"163"," l ":"164","a r":"165","eri":"166","ett":"167","lo ":"168","nza":"169","que":"170","str":"171","ter":"172","tta":"173"," ba":"174"," li":"175"," te":"176","ass":"177","e f":"178","enz":"179","for":"180","nno":"181","olo":"182","ori":"183","res":"184","tor":"185"," ci":"186"," vo":"187","a i":"188","al ":"189","chi":"190","e n":"191","lia":"192","pre":"193","ria":"194","uni":"195","ver":"196"," sp":"197","imo":"198","l a":"199","l c":"200","ran":"201","sen":"202","soc":"203","tic":"204"," fi":"205"," mo":"206","a n":"207","ce ":"208","dei":"209","ggi":"210","gio":"211","iti":"212","l s":"213","lit":"214","ll ":"215","mon":"216","ola":"217","pac":"218","sim":"219","tit":"220","utt":"221","vol":"222"," ar":"223"," fo":"224"," ha":"225"," sa":"226","acc":"227","e r":"228","ire":"229","man":"230","ntr":"231","rat":"232","sco":"233","tro":"234","tut":"235","va ":"236"," do":"237"," gi":"238"," me":"239"," sc":"240"," tu":"241"," ve":"242"," vi":"243","a m":"244","ber":"245","can":"246","cit":"247","i l":"248","ier":"249","ità":"250","lli":"251","min":"252","n p":"253","nat":"254","nda":"255","o e":"256","o f":"257","o u":"258","ore":"259","oro":"260","ort":"261","sto":"262","ten":"263","tiv":"264","van":"265","art":"266","cco":"267","ci ":"268","cos":"269","dal":"270","e v":"271","i i":"272","ila":"273","ino":"274","l p":"275","n c":"276","nit":"277","ole":"278","ome":"279","po ":"280","rio":"281","sa ":"282"," ce":"283"," es":"284"," tr":"285","a b":"286","and":"287","ata":"288","der":"289","ens":"290","ers":"291","gi ":"292","ial":"293","ina":"294","itt":"295","izi":"296","lan":"297","lor":"298","mil":"299"},"kazakh":{"ан ":"0","ен ":"1","ың ":"2"," қа":"3"," ба":"4","ай ":"5","нда":"6","ын ":"7"," са":"8"," ал":"9","ді ":"10","ары":"11","ды ":"12","ып ":"13"," мұ":"14"," бі":"15","асы":"16","да ":"17","най":"18"," жа":"19","мұн":"20","ста":"21","ған":"22","н б":"23","ұна":"24"," бо":"25","ның":"26","ін ":"27","лар":"28","сын":"29"," де":"30","аға":"31","тан":"32"," кө":"33","бір":"34","ер ":"35","мен":"36","аза":"37","ынд":"38","ыны":"39"," ме":"40","анд":"41","ері":"42","бол":"43","дың":"44","қаз":"45","аты":"46","сы ":"47","тын":"48","ғы ":"49"," ке":"50","ар ":"51","зақ":"52","ық ":"53","ала":"54","алы":"55","аны":"56","ара":"57","ағы":"58","ген":"59","тар":"60","тер":"61","тыр":"62","айд":"63","ард":"64","де ":"65","ға ":"66"," қо":"67","бар":"68","ің ":"69","қан":"70"," бе":"71"," қы":"72","ақс":"73","гер":"74","дан":"75","дар":"76","лық":"77","лға":"78","ына":"79","ір ":"80","ірі":"81","ғас":"82"," та":"83","а б":"84","гі ":"85","еді":"86","еле":"87","йды":"88","н к":"89","н т":"90","ола":"91","рын":"92","іп ":"93","қст":"94","қта":"95","ң б":"96"," ай":"97"," ол":"98"," со":"99","айт":"100","дағ":"101","иге":"102","лер":"103","лып":"104","н а":"105","ік ":"106","ақт":"107","бағ":"108","кен":"109","н қ":"110","ны ":"111","рге":"112","рға":"113","ыр ":"114"," ар":"115","алғ":"116","аса":"117","бас":"118","бер":"119","ге ":"120","еті":"121","на ":"122","нде":"123","не ":"124","ниг":"125","рды":"126","ры ":"127","сай":"128"," ау":"129"," кү":"130"," ни":"131"," от":"132"," өз":"133","ауд":"134","еп ":"135","иял":"136","лты":"137","н ж":"138","н о":"139","осы":"140","оты":"141","рып":"142","рі ":"143","тке":"144","ты ":"145","ы б":"146","ы ж":"147","ылы":"148","ысы":"149","і с":"150","қар":"151"," бұ":"152"," да":"153"," же":"154"," тұ":"155"," құ":"156","ады":"157","айл":"158","ап ":"159","ата":"160","ені":"161","йла":"162","н м":"163","н с":"164","нды":"165","нді":"166","р м":"167","тай":"168","тін":"169","ы т":"170","ыс ":"171","інд":"172"," би":"173","а ж":"174","ауы":"175","деп":"176","дің":"177","еке":"178","ери":"179","йын":"180","кел":"181","лды":"182","ма ":"183","нан":"184","оны":"185","п ж":"186","п о":"187","р б":"188","рия":"189","рла":"190","уда":"191","шыл":"192","ы а":"193","ықт":"194","і а":"195","і б":"196","із ":"197","ілі":"198","ң қ":"199"," ас":"200"," ек":"201"," жо":"202"," мә":"203"," ос":"204"," ре":"205"," се":"206","алд":"207","дал":"208","дег":"209","дей":"210","е б":"211","ет ":"212","жас":"213","й б":"214","лау":"215","лда":"216","мет":"217","нын":"218","сар":"219","сі ":"220","ті ":"221","ыры":"222","ыта":"223","ісі":"224","ң а":"225","өте":"226"," ат":"227"," ел":"228"," жү":"229"," ма":"230"," то":"231"," шы":"232","а а":"233","алт":"234","ама":"235","арл":"236","аст":"237","бұл":"238","дай":"239","дық":"240","ек ":"241","ель":"242","есі":"243","зді":"244","көт":"245","лем":"246","ль ":"247","н е":"248","п а":"249","р а":"250","рес":"251","са ":"252","та ":"253","тте":"254","тұр":"255","шы ":"256","ы д":"257","ы қ":"258","ыз ":"259","қыт":"260"," ко":"261"," не":"262"," ой":"263"," ор":"264"," сұ":"265"," тү":"266","аль":"267","аре":"268","атт":"269","дір":"270","ев ":"271","егі":"272","еда":"273","екі":"274","елд":"275","ерг":"276","ерд":"277","ияд":"278","кер":"279","кет":"280","лыс":"281","ліс":"282","мед":"283","мпи":"284","н д":"285","ні ":"286","нін":"287","п т":"288","пек":"289","рел":"290","рта":"291","ріл":"292","рін":"293","сен":"294","тал":"295","шіл":"296","ы к":"297","ы м":"298","ыст":"299"},"kyrgyz":{"ын ":"0","ан ":"1"," жа":"2","ен ":"3","да ":"4"," та":"5","ар ":"6","ин ":"7"," ка":"8","ары":"9"," ал":"10"," ба":"11"," би":"12","лар":"13"," бо":"14"," кы":"15","ала":"16","н к":"17"," са":"18","нда":"19","ган":"20","тар":"21"," де":"22","анд":"23","н б":"24"," ке":"25","ард":"26","мен":"27","н т":"28","ара":"29","нын":"30"," да":"31"," ме":"32","кыр":"33"," че":"34","н а":"35","ры ":"36"," ко":"37","ген":"38","дар":"39","кен":"40","кта":"41","уу ":"42","ене":"43","ери":"44"," ша":"45","алы":"46","ат ":"47","на ":"48"," кө":"49"," эм":"50","аты":"51","дан":"52","деп":"53","дын":"54","еп ":"55","нен":"56","рын":"57"," бе":"58","кан":"59","луу":"60","ргы":"61","тан":"62","шай":"63","ырг":"64","үн ":"65"," ар":"66"," ма":"67","агы":"68","акт":"69","аны":"70","гы ":"71","гыз":"72","ды ":"73","рда":"74","ай ":"75","бир":"76","бол":"77","ер ":"78","н с":"79","нды":"80","ун ":"81","ча ":"82","ынд":"83","а к":"84","ага":"85","айл":"86","ана":"87","ап ":"88","га ":"89","лге":"90","нча":"91","п к":"92","рды":"93","туу":"94","ыны":"95"," ан":"96"," өз":"97","ама":"98","ата":"99","дин":"100","йт ":"101","лга":"102","лоо":"103","оо ":"104","ри ":"105","тин":"106","ыз ":"107","ып ":"108","өрү":"109"," па":"110"," эк":"111","а б":"112","алг":"113","асы":"114","ашт":"115","биз":"116","кел":"117","кте":"118","тал":"119"," не":"120"," су":"121","акы":"122","ент":"123","инд":"124","ир ":"125","кал":"126","н д":"127","нде":"128","ого":"129","онд":"130","оюн":"131","р б":"132","р м":"133","ран":"134","сал":"135","ста":"136","сы ":"137","ура":"138","ыгы":"139"," аш":"140"," ми":"141"," сы":"142"," ту":"143","ал ":"144","арт":"145","бор":"146","елг":"147","ени":"148","ет ":"149","жат":"150","йло":"151","кар":"152","н м":"153","огу":"154","п а":"155","п ж":"156","р э":"157","сын":"158","ык ":"159","юнч":"160"," бу":"161"," ур":"162","а а":"163","ак ":"164","алд":"165","алу":"166","бар":"167","бер":"168","бою":"169","ге ":"170","дон":"171","еги":"172","ект":"173","ефт":"174","из ":"175","кат":"176","лды":"177","н ч":"178","н э":"179","н ө":"180","ндо":"181","неф":"182","он ":"183","сат":"184","тор":"185","ты ":"186","уда":"187","ул ":"188","ула":"189","ууд":"190","ы б":"191","ы ж":"192","ы к":"193","ыл ":"194","ына":"195","эке":"196","ясы":"197"," ат":"198"," до":"199"," жы":"200"," со":"201"," чы":"202","аас":"203","айт":"204","аст":"205","баа":"206","баш":"207","гар":"208","гын":"209","дө ":"210","е б":"211","ек ":"212","жыл":"213","и б":"214","ик ":"215","ияс":"216","кыз":"217","лда":"218","лык":"219","мда":"220","н ж":"221","нди":"222","ни ":"223","нин":"224","орд":"225","рдо":"226","сто":"227","та ":"228","тер":"229","тти":"230","тур":"231","тын":"232","уп ":"233","ушу":"234","фти":"235","ыкт":"236","үп ":"237","өн ":"238"," ай":"239"," бү":"240"," ич":"241"," иш":"242"," мо":"243"," пр":"244"," ре":"245"," өк":"246"," өт":"247","а д":"248","а у":"249","а э":"250","айм":"251","амд":"252","атт":"253","бек":"254","бул":"255","гол":"256","дег":"257","еге":"258","ейт":"259","еле":"260","енд":"261","жак":"262","и к":"263","ини":"264","ири":"265","йма":"266","кто":"267","лик":"268","мак":"269","мес":"270","н у":"271","н ш":"272","нтт":"273","ол ":"274","оло":"275","пар":"276","рак":"277","рүү":"278","сыр":"279","ти ":"280","тик":"281","тта":"282","төр":"283","у ж":"284","у с":"285","шка":"286","ы м":"287","ызы":"288","ылд":"289","эме":"290","үрү":"291","өлү":"292","өтө":"293"," же":"294"," тү":"295"," эл":"296"," өн":"297","а ж":"298","ады":"299"},"latin":{"um ":"0","us ":"1","ut ":"2","et ":"3","is ":"4"," et":"5"," in":"6"," qu":"7","tur":"8"," pr":"9","est":"10","tio":"11"," au":"12","am ":"13","em ":"14","aut":"15"," di":"16","ent":"17","in ":"18","dic":"19","t e":"20"," es":"21","ur ":"22","ati":"23","ion":"24","st ":"25"," ut":"26","ae ":"27","qua":"28"," de":"29","nt ":"30"," su":"31"," si":"32","itu":"33","unt":"34","rum":"35","ia ":"36","es ":"37","ter":"38"," re":"39","nti":"40","rae":"41","s e":"42","qui":"43","io ":"44","pro":"45","it ":"46","per":"47","ita":"48","one":"49","ici":"50","ius":"51"," co":"52","t d":"53","bus":"54","pra":"55","m e":"56"," no":"57","edi":"58","tia":"59","ue ":"60","ibu":"61"," se":"62"," ad":"63","er ":"64"," fi":"65","ili":"66","que":"67","t i":"68","de ":"69","oru":"70"," te":"71","ali":"72"," pe":"73","aed":"74","cit":"75","m d":"76","t s":"77","tat":"78","tem":"79","tis":"80","t p":"81","sti":"82","te ":"83","cum":"84","ere":"85","ium":"86"," ex":"87","rat":"88","ta ":"89","con":"90","cti":"91","oni":"92","ra ":"93","s i":"94"," cu":"95"," sa":"96","eni":"97","nis":"98","nte":"99","eri":"100","omi":"101","re ":"102","s a":"103","min":"104","os ":"105","ti ":"106","uer":"107"," ma":"108"," ue":"109","m s":"110","nem":"111","t m":"112"," mo":"113"," po":"114"," ui":"115","gen":"116","ict":"117","m i":"118","ris":"119","s s":"120","t a":"121","uae":"122"," do":"123","m a":"124","t c":"125"," ge":"126","as ":"127","e i":"128","e p":"129","ne ":"130"," ca":"131","ine":"132","quo":"133","s p":"134"," al":"135","e e":"136","ntu":"137","ro ":"138","tri":"139","tus":"140","uit":"141","atu":"142","ini":"143","iqu":"144","m p":"145","ost":"146","res":"147","ura":"148"," ac":"149"," fu":"150","a e":"151","ant":"152","nes":"153","nim":"154","sun":"155","tra":"156","e a":"157","s d":"158"," pa":"159"," uo":"160","ecu":"161"," om":"162"," tu":"163","ad ":"164","cut":"165","omn":"166","s q":"167"," ei":"168","ex ":"169","icu":"170","tor":"171","uid":"172"," ip":"173"," me":"174","e s":"175","era":"176","eru":"177","iam":"178","ide":"179","ips":"180"," iu":"181","a s":"182","do ":"183","e d":"184","eiu":"185","ica":"186","im ":"187","m c":"188","m u":"189","tiu":"190"," ho":"191","cat":"192","ist":"193","nat":"194","on ":"195","pti":"196","reg":"197","rit":"198","s t":"199","sic":"200","spe":"201"," en":"202"," sp":"203","dis":"204","eli":"205","liq":"206","lis":"207","men":"208","mus":"209","num":"210","pos":"211","sio":"212"," an":"213"," gr":"214","abi":"215","acc":"216","ect":"217","ri ":"218","uan":"219"," le":"220","ecc":"221","ete":"222","gra":"223","non":"224","se ":"225","uen":"226","uis":"227"," fa":"228"," tr":"229","ate":"230","e c":"231","fil":"232","na ":"233","ni ":"234","pul":"235","s f":"236","ui ":"237","at ":"238","cce":"239","dam":"240","i e":"241","ina":"242","leg":"243","nos":"244","ori":"245","pec":"246","rop":"247","sta":"248","uia":"249","ene":"250","iue":"251","iui":"252","siu":"253","t t":"254","t u":"255","tib":"256","tit":"257"," da":"258"," ne":"259","a d":"260","and":"261","ege":"262","equ":"263","hom":"264","imu":"265","lor":"266","m m":"267","mni":"268","ndo":"269","ner":"270","o e":"271","r e":"272","sit":"273","tum":"274","utu":"275","a p":"276","bis":"277","bit":"278","cer":"279","cta":"280","dom":"281","fut":"282","i s":"283","ign":"284","int":"285","mod":"286","ndu":"287","nit":"288","rib":"289","rti":"290","tas":"291","und":"292"," ab":"293","err":"294","ers":"295","ite":"296","iti":"297","m t":"298","o p":"299"},"latvian":{"as ":"0"," la":"1"," pa":"2"," ne":"3","es ":"4"," un":"5","un ":"6"," ka":"7"," va":"8","ar ":"9","s p":"10"," ar":"11"," vi":"12","is ":"13","ai ":"14"," no":"15","ja ":"16","ija":"17","iem":"18","em ":"19","tu ":"20","tie":"21","vie":"22","lat":"23","aks":"24","ien":"25","kst":"26","ies":"27","s a":"28","rak":"29","atv":"30","tvi":"31"," ja":"32"," pi":"33","ka ":"34"," ir":"35","ir ":"36","ta ":"37"," sa":"38","ts ":"39"," kā":"40","ās ":"41"," ti":"42","ot ":"43","s n":"44"," ie":"45"," ta":"46","arī":"47","par":"48","pie":"49"," pr":"50","kā ":"51"," at":"52"," ra":"53","am ":"54","inā":"55","tā ":"56"," iz":"57","jas":"58","lai":"59"," na":"60","aut":"61","ieš":"62","s s":"63"," ap":"64"," ko":"65"," st":"66","iek":"67","iet":"68","jau":"69","us ":"70","rī ":"71","tik":"72","ība":"73","na ":"74"," ga":"75","cij":"76","s i":"77"," uz":"78","jum":"79","s v":"80","ms ":"81","var":"82"," ku":"83"," ma":"84","jā ":"85","sta":"86","s u":"87"," tā":"88","die":"89","kai":"90","kas":"91","ska":"92"," ci":"93"," da":"94","kur":"95","lie":"96","tas":"97","a p":"98","est":"99","stā":"100","šan":"101","nes":"102","nie":"103","s d":"104","s m":"105","val":"106"," di":"107"," es":"108"," re":"109","no ":"110","to ":"111","umu":"112","vai":"113","ši ":"114"," vē":"115","kum":"116","nu ":"117","rie":"118","s t":"119","ām ":"120","ad ":"121","et ":"122","mu ":"123","s l":"124"," be":"125","aud":"126","tur":"127","vij":"128","viņ":"129","āju":"130","bas":"131","gad":"132","i n":"133","ika":"134","os ":"135","a v":"136","not":"137","oti":"138","sts":"139","aik":"140","u a":"141","ā a":"142","āk ":"143"," to":"144","ied":"145","stu":"146","ti ":"147","u p":"148","vēl":"149","āci":"150"," šo":"151","gi ":"152","ko ":"153","pro":"154","s r":"155","tāj":"156","u s":"157","u v":"158","vis":"159","aun":"160","ks ":"161","str":"162","zin":"163","a a":"164","adī":"165","da ":"166","dar":"167","ena":"168","ici":"169","kra":"170","nas":"171","stī":"172","šu ":"173"," mē":"174","a n":"175","eci":"176","i s":"177","ie ":"178","iņa":"179","ju ":"180","las":"181","r t":"182","ums":"183","šie":"184","bu ":"185","cit":"186","i a":"187","ina":"188","ma ":"189","pus":"190","ra ":"191"," au":"192"," se":"193"," sl":"194","a s":"195","ais":"196","eši":"197","iec":"198","iku":"199","pār":"200","s b":"201","s k":"202","sot":"203","ādā":"204"," in":"205"," li":"206"," tr":"207","ana":"208","eso":"209","ikr":"210","man":"211","ne ":"212","u k":"213"," tu":"214","an ":"215","av ":"216","bet":"217","būt":"218","im ":"219","isk":"220","līd":"221","nav":"222","ras":"223","ri ":"224","s g":"225","sti":"226","īdz":"227"," ai":"228","arb":"229","cin":"230","das":"231","ent":"232","gal":"233","i p":"234","lik":"235","mā ":"236","nek":"237","pat":"238","rēt":"239","si ":"240","tra":"241","uši":"242","vei":"243"," br":"244"," pu":"245"," sk":"246","als":"247","ama":"248","edz":"249","eka":"250","ešu":"251","ieg":"252","jis":"253","kam":"254","lst":"255","nāk":"256","oli":"257","pre":"258","pēc":"259","rot":"260","tās":"261","usi":"262","ēl ":"263","ēs ":"264"," bi":"265"," de":"266"," me":"267"," pā":"268","a i":"269","aid":"270","ajā":"271","ikt":"272","kat":"273","lic":"274","lod":"275","mi ":"276","ni ":"277","pri":"278","rād":"279","rīg":"280","sim":"281","trā":"282","u l":"283","uto":"284","uz ":"285","ēc ":"286","ītā":"287"," ce":"288"," jā":"289"," sv":"290","a t":"291","aga":"292","aiz":"293","atu":"294","ba ":"295","cie":"296","du ":"297","dzi":"298","dzī":"299"},"lithuanian":{"as ":"0"," pa":"1"," ka":"2","ai ":"3","us ":"4","os ":"5","is ":"6"," ne":"7"," ir":"8","ir ":"9","ti ":"10"," pr":"11","aus":"12","ini":"13","s p":"14","pas":"15","ių ":"16"," ta":"17"," vi":"18","iau":"19"," ko":"20"," su":"21","kai":"22","o p":"23","usi":"24"," sa":"25","vo ":"26","tai":"27","ali":"28","tų ":"29","io ":"30","jo ":"31","s k":"32","sta":"33","iai":"34"," bu":"35"," nu":"36","ius":"37","mo ":"38"," po":"39","ien":"40","s s":"41","tas":"42"," me":"43","uvo":"44","kad":"45"," iš":"46"," la":"47","to ":"48","ais":"49","ie ":"50","kur":"51","uri":"52"," ku":"53","ijo":"54","čia":"55","au ":"56","met":"57","je ":"58"," va":"59","ad ":"60"," ap":"61","and":"62"," gr":"63"," ti":"64","kal":"65","asi":"66","i p":"67","iči":"68","s i":"69","s v":"70","ink":"71","o n":"72","ės ":"73","buv":"74","s a":"75"," ga":"76","aip":"77","avi":"78","mas":"79","pri":"80","tik":"81"," re":"82","etu":"83","jos":"84"," da":"85","ent":"86","oli":"87","par":"88","ant":"89","ara":"90","tar":"91","ama":"92","gal":"93","imo":"94","išk":"95","o s":"96"," at":"97"," be":"98"," į ":"99","min":"100","tin":"101"," tu":"102","s n":"103"," jo":"104","dar":"105","ip ":"106","rei":"107"," te":"108","dži":"109","kas":"110","nin":"111","tei":"112","vie":"113"," li":"114"," se":"115","cij":"116","gar":"117","lai":"118","art":"119","lau":"120","ras":"121","no ":"122","o k":"123","tą ":"124"," ar":"125","ėjo":"126","vič":"127","iga":"128","pra":"129","vis":"130"," na":"131","men":"132","oki":"133","raš":"134","s t":"135","iet":"136","ika":"137","int":"138","kom":"139","tam":"140","aug":"141","avo":"142","rie":"143","s b":"144"," st":"145","eim":"146","ko ":"147","nus":"148","pol":"149","ria":"150","sau":"151","api":"152","me ":"153","ne ":"154","sik":"155"," ši":"156","i n":"157","ia ":"158","ici":"159","oja":"160","sak":"161","sti":"162","ui ":"163","ame":"164","lie":"165","o t":"166","pie":"167","čiu":"168"," di":"169"," pe":"170","gri":"171","ios":"172","lia":"173","lin":"174","s d":"175","s g":"176","ta ":"177","uot":"178"," ja":"179"," už":"180","aut":"181","i s":"182","ino":"183","mą ":"184","oje":"185","rav":"186","dėl":"187","nti":"188","o a":"189","toj":"190","ėl ":"191"," to":"192"," vy":"193","ar ":"194","ina":"195","lic":"196","o v":"197","sei":"198","su ":"199"," mi":"200"," pi":"201","din":"202","iš ":"203","lan":"204","si ":"205","tus":"206"," ba":"207","asa":"208","ata":"209","kla":"210","omi":"211","tat":"212"," an":"213"," ji":"214","als":"215","ena":"216","jų ":"217","nuo":"218","per":"219","rig":"220","s m":"221","val":"222","yta":"223","čio":"224"," ra":"225","i k":"226","lik":"227","net":"228","nė ":"229","tis":"230","tuo":"231","yti":"232","ęs ":"233","ų s":"234","ada":"235","ari":"236","do ":"237","eik":"238","eis":"239","ist":"240","lst":"241","ma ":"242","nes":"243","sav":"244","sio":"245","tau":"246"," ki":"247","aik":"248","aud":"249","ies":"250","ori":"251","s r":"252","ska":"253"," ge":"254","ast":"255","eig":"256","et ":"257","iam":"258","isa":"259","mis":"260","nam":"261","ome":"262","žia":"263","aba":"264","aul":"265","ikr":"266","ką ":"267","nta":"268","ra ":"269","tur":"270"," ma":"271","die":"272","ei ":"273","i t":"274","nas":"275","rin":"276","sto":"277","tie":"278","tuv":"279","vos":"280","ų p":"281"," dė":"282","are":"283","ats":"284","enė":"285","ili":"286","ima":"287","kar":"288","ms ":"289","nia":"290","r p":"291","rod":"292","s l":"293"," o ":"294","e p":"295","es ":"296","ide":"297","ik ":"298","ja ":"299"},"macedonian":{"на ":"0"," на":"1","та ":"2","ата":"3","ија":"4"," пр":"5","то ":"6","ја ":"7"," за":"8","а н":"9"," и ":"10","а с":"11","те ":"12","ите":"13"," ко":"14","от ":"15"," де":"16"," по":"17","а д":"18","во ":"19","за ":"20"," во":"21"," од":"22"," се":"23"," не":"24","се ":"25"," до":"26","а в":"27","ка ":"28","ање":"29","а п":"30","о п":"31","ува":"32","циј":"33","а о":"34","ици":"35","ето":"36","о н":"37","ани":"38","ни ":"39"," вл":"40","дек":"41","ека":"42","њет":"43","ќе ":"44"," е ":"45","а з":"46","а и":"47","ат ":"48","вла":"49","го ":"50","е н":"51","од ":"52","пре":"53"," го":"54"," да":"55"," ма":"56"," ре":"57"," ќе":"58","али":"59","и д":"60","и н":"61","иот":"62","нат":"63","ово":"64"," па":"65"," ра":"66"," со":"67","ове":"68","пра":"69","што":"70","ње ":"71","а е":"72","да ":"73","дат":"74","дон":"75","е в":"76","е д":"77","е з":"78","е с":"79","кон":"80","нит":"81","но ":"82","они":"83","ото":"84","пар":"85","при":"86","ста":"87","т н":"88"," шт":"89","а к":"90","аци":"91","ва ":"92","вањ":"93","е п":"94","ени":"95","ла ":"96","лад":"97","мак":"98","нес":"99","нос":"100","про":"101","рен":"102","јат":"103"," ин":"104"," ме":"105"," то":"106","а г":"107","а м":"108","а р":"109","аке":"110","ако":"111","вор":"112","гов":"113","едо":"114","ена":"115","и и":"116","ира":"117","кед":"118","не ":"119","ниц":"120","ниј":"121","ост":"122","ра ":"123","рат":"124","ред":"125","ска":"126","тен":"127"," ка":"128"," сп":"129"," ја":"130","а т":"131","аде":"132","арт":"133","е г":"134","е и":"135","кат":"136","лас":"137","нио":"138","о с":"139","ри ":"140"," ба":"141"," би":"142","ава":"143","ате":"144","вни":"145","д н":"146","ден":"147","дов":"148","држ":"149","дув":"150","е о":"151","ен ":"152","ере":"153","ери":"154","и п":"155","и с":"156","ина":"157","кој":"158","нци":"159","о м":"160","о о":"161","одн":"162","пор":"163","ски":"164","спо":"165","ств":"166","сти":"167","тво":"168","ти ":"169"," об":"170"," ов":"171","а б":"172","алн":"173","ара":"174","бар":"175","е к":"176","ед ":"177","ент":"178","еѓу":"179","и о":"180","ии ":"181","меѓ":"182","о д":"183","оја":"184","пот":"185","раз":"186","раш":"187","спр":"188","сто":"189","т д":"190","ци ":"191"," бе":"192"," гр":"193"," др":"194"," из":"195"," ст":"196","аа ":"197","бид":"198","вед":"199","гла":"200","еко":"201","енд":"202","есе":"203","етс":"204","зац":"205","и т":"206","иза":"207","инс":"208","ист":"209","ки ":"210","ков":"211","кол":"212","ку ":"213","лиц":"214","о з":"215","о и":"216","ова":"217","олк":"218","оре":"219","ори":"220","под":"221","рањ":"222","реф":"223","ржа":"224","ров":"225","рти":"226","со ":"227","тор":"228","фер":"229","цен":"230","цит":"231"," а ":"232"," вр":"233"," гл":"234"," дп":"235"," мо":"236"," ни":"237"," но":"238"," оп":"239"," от":"240","а ќ":"241","або":"242","ада":"243","аса":"244","аша":"245","ба ":"246","бот":"247","ваа":"248","ват":"249","вот":"250","ги ":"251","гра":"252","де ":"253","дин":"254","дум":"255","евр":"256","еду":"257","ено":"258","ера":"259","ес ":"260","ење":"261","же ":"262","зак":"263","и в":"264","ила":"265","иту":"266","коа":"267","кои":"268","лан":"269","лку":"270","лож":"271","мот":"272","нду":"273","нст":"274","о в":"275","оа ":"276","оал":"277","обр":"278","ов ":"279","ови":"280","овн":"281","ои ":"282","ор ":"283","орм":"284","ој ":"285","рет":"286","сед":"287","ст ":"288","тер":"289","тиј":"290","тоа":"291","фор":"292","ции":"293","ѓу ":"294"," ал":"295"," ве":"296"," вм":"297"," ги":"298"," ду":"299"},"mongolian":{"ын ":"0"," ба":"1","йн ":"2","бай":"3","ийн":"4","уул":"5"," ул":"6","улс":"7","ан ":"8"," ха":"9","ний":"10","н х":"11","гаа":"12","сын":"13","ий ":"14","лсы":"15"," бо":"16","й б":"17","эн ":"18","ах ":"19","бол":"20","ол ":"21","н б":"22","оло":"23"," хэ":"24","онг":"25","гол":"26","гуу":"27","нго":"28","ыг ":"29","жил":"30"," мо":"31","лаг":"32","лла":"33","мон":"34"," тє":"35"," ху":"36","айд":"37","ны ":"38","он ":"39","сан":"40","хий":"41"," аж":"42"," ор":"43","л у":"44","н т":"45","улг":"46","айг":"47","длы":"48","йг ":"49"," за":"50","дэс":"51","н а":"52","ндэ":"53","ула":"54","ээ ":"55","ага":"56","ийг":"57","vй ":"58","аа ":"59","й а":"60","лын":"61","н з":"62"," аю":"63"," зє":"64","аар":"65","ад ":"66","ар ":"67","гvй":"68","зєв":"69","ажи":"70","ал ":"71","аюу":"72","г х":"73","лгv":"74","лж ":"75","сни":"76","эсн":"77","юул":"78","йдл":"79","лыг":"80","нхи":"81","ууд":"82","хам":"83"," нэ":"84"," са":"85","гий":"86","лах":"87","лєл":"88","рєн":"89","єгч":"90"," та":"91","илл":"92","лий":"93","лэх":"94","рий":"95","эх ":"96"," ер":"97"," эр":"98","влє":"99","ерє":"100","ийл":"101","лон":"102","лєг":"103","євл":"104","єнх":"105"," хо":"106","ари":"107","их ":"108","хан":"109","эр ":"110","єн ":"111","vvл":"112","ж б":"113","тэй":"114","х х":"115","эрх":"116"," vн":"117"," нь":"118","vнд":"119","алт":"120","йлє":"121","нь ":"122","тєр":"123"," га":"124"," су":"125","аан":"126","даа":"127","илц":"128","йгу":"129","л а":"130","лаа":"131","н н":"132","руу":"133","эй ":"134"," то":"135","н с":"136","рил":"137","єри":"138","ааг":"139","гч ":"140","лээ":"141","н о":"142","рэг":"143","суу":"144","эрэ":"145","їїл":"146"," yн":"147"," бу":"148"," дэ":"149"," ол":"150"," ту":"151"," ши":"152","yнд":"153","аши":"154","г т":"155","иг ":"156","йл ":"157","хар":"158","шин":"159","эг ":"160","єр ":"161"," их":"162"," хє":"163"," хї":"164","ам ":"165","анг":"166","ин ":"167","йга":"168","лса":"169","н v":"170","н е":"171","нал":"172","нд ":"173","хуу":"174","цаа":"175","эд ":"176","ээр":"177","єл ":"178","vйл":"179","ада":"180","айн":"181","ала":"182","амт":"183","гах":"184","д х":"185","дал":"186","зар":"187","л б":"188","лан":"189","н д":"190","сэн":"191","улл":"192","х б":"193","хэр":"194"," бv":"195"," да":"196"," зо":"197","vрэ":"198","аад":"199","гээ":"200","лэн":"201","н и":"202","н э":"203","нга":"204","нэ ":"205","тал":"206","тын":"207","хур":"208","эл ":"209"," на":"210"," ни":"211"," он":"212","vлэ":"213","аг ":"214","аж ":"215","ай ":"216","ата":"217","бар":"218","г б":"219","гад":"220","гїй":"221","й х":"222","лт ":"223","н м":"224","на ":"225","оро":"226","уль":"227","чин":"228","эж ":"229","энэ":"230","ээд":"231","їй ":"232","їлэ":"233"," би":"234"," тэ":"235"," эн":"236","аны":"237","дий":"238","дээ":"239","лал":"240","лга":"241","лд ":"242","лог":"243","ль ":"244","н у":"245","н ї":"246","р б":"247","рал":"248","сон":"249","тай":"250","удл":"251","элт":"252","эрг":"253","єлє":"254"," vй":"255"," в ":"256"," гэ":"257"," хv":"258","ара":"259","бvр":"260","д н":"261","д о":"262","л х":"263","лс ":"264","лты":"265","н г":"266","нэг":"267","огт":"268","олы":"269","оёр":"270","р т":"271","рээ":"272","тав":"273","тог":"274","уур":"275","хоё":"276","хэл":"277","хээ":"278","элэ":"279","ёр ":"280"," ав":"281"," ас":"282"," аш":"283"," ду":"284"," со":"285"," чи":"286"," эв":"287"," єр":"288","аал":"289","алд":"290","амж":"291","анд":"292","асу":"293","вэр":"294","г у":"295","двэ":"296","жvv":"297","лца":"298","лэл":"299"},"nepali":{"को ":"0","का ":"1","मा ":"2","हरु":"3"," ने":"4","नेप":"5","पाल":"6","ेपा":"7"," सम":"8","ले ":"9"," प्":"10","प्र":"11","कार":"12","ा स":"13","एको":"14"," भए":"15"," छ ":"16"," भा":"17","्रम":"18"," गर":"19","रुक":"20"," र ":"21","भार":"22","ारत":"23"," का":"24"," वि":"25","भएक":"26","ाली":"27","ली ":"28","ा प":"29","ीहर":"30","ार्":"31","ो छ":"32","ना ":"33","रु ":"34","ालक":"35","्या":"36"," बा":"37","एका":"38","ने ":"39","न्त":"40","ा ब":"41","ाको":"42","ार ":"43","ा भ":"44","ाहर":"45","्रो":"46","क्ष":"47","न् ":"48","ारी":"49"," नि":"50","ा न":"51","ी स":"52"," डु":"53","क्र":"54","जना":"55","यो ":"56","ा छ":"57","ेवा":"58","्ता":"59"," रा":"60","त्य":"61","न्द":"62","हुन":"63","ा क":"64","ामा":"65","ी न":"66","्दा":"67"," से":"68","छन्":"69","म्ब":"70","रोत":"71","सेव":"72","स्त":"73","स्र":"74","ेका":"75","्त ":"76"," बी":"77"," हु":"78","क्त":"79","त्र":"80","रत ":"81","र्न":"82","र्य":"83","ा र":"84","ाका":"85","ुको":"86"," एक":"87"," सं":"88"," सु":"89","बीब":"90","बीस":"91","लको":"92","स्य":"93","ीबी":"94","ीसी":"95","ेको":"96","ो स":"97","्यक":"98"," छन":"99"," जन":"100"," बि":"101"," मु":"102"," स्":"103","गर्":"104","ताह":"105","न्ध":"106","बार":"107","मन्":"108","मस्":"109","रुल":"110","लाई":"111","ा व":"112","ाई ":"113","ाल ":"114","िका":"115"," त्":"116"," मा":"117"," यस":"118"," रु":"119","ताक":"120","बन्":"121","र ब":"122","रण ":"123","रुप":"124","रेक":"125","ष्ट":"126","सम्":"127","सी ":"128","ाएक":"129","ुका":"130","ुक्":"131"," अध":"132"," अन":"133"," तथ":"134"," थि":"135"," दे":"136"," पर":"137"," बै":"138","तथा":"139","ता ":"140","दा ":"141","द्द":"142","नी ":"143","बाट":"144","यक्":"145","री ":"146","रीह":"147","र्म":"148","लका":"149","समस":"150","ा अ":"151","ा ए":"152","ाट ":"153","िय ":"154","ो प":"155","ो म":"156","्न ":"157","्ने":"158","्षा":"159"," पा":"160"," यो":"161"," हा":"162","अधि":"163","डुव":"164","त भ":"165","त स":"166","था ":"167","धिक":"168","पमा":"169","बैठ":"170","मुद":"171","या ":"172","युक":"173","र न":"174","रति":"175","वान":"176","सार":"177","ा आ":"178","ा ज":"179","ा ह":"180","ुद्":"181","ुपम":"182","ुले":"183","ुवा":"184","ैठक":"185","ो ब":"186","्तर":"187","्य ":"188","्यस":"189"," क्":"190"," मन":"191"," रह":"192","चार":"193","तिय":"194","दै ":"195","निर":"196","नु ":"197","पर्":"198","रक्":"199","र्द":"200","समा":"201","सुर":"202","ाउन":"203","ान ":"204","ानम":"205","ारण":"206","ाले":"207","ि ब":"208","ियो":"209","ुन्":"210","ुरक":"211","्त्":"212","्बन":"213","्रा":"214","्ष ":"215"," आर":"216"," जल":"217"," बे":"218"," या":"219"," सा":"220","आएक":"221","एक ":"222","कर्":"223","जलस":"224","णका":"225","त र":"226","द्र":"227","धान":"228","धि ":"229","नका":"230","नमा":"231","नि ":"232","ममा":"233","रम ":"234","रहे":"235","राज":"236","लस्":"237","ला ":"238","वार":"239","सका":"240","हिल":"241","हेक":"242","ा त":"243","ारे":"244","िन्":"245","िस्":"246","े स":"247","ो न":"248","ो र":"249","ोत ":"250","्धि":"251","्मी":"252","्रस":"253"," दु":"254"," पन":"255"," बत":"256"," बन":"257"," भन":"258","ंयु":"259","आरम":"260","खि ":"261","ण्ड":"262","तका":"263","ताल":"264","दी ":"265","देख":"266","निय":"267","पनि":"268","प्त":"269","बता":"270","मी ":"271","म्भ":"272","र स":"273","रम्":"274","लमा":"275","विश":"276","षाक":"277","संय":"278","ा ड":"279","ा म":"280","ानक":"281","ालम":"282","ि भ":"283","ित ":"284","ी प":"285","ी र":"286","ु भ":"287","ुने":"288","े ग":"289","ेखि":"290","ेर ":"291","ो भ":"292","ो व":"293","ो ह":"294","्भ ":"295","्र ":"296"," ता":"297"," नम":"298"," ना":"299"},"norwegian":{"er ":"0","en ":"1","et ":"2"," de":"3","det":"4"," i ":"5","for":"6","il ":"7"," fo":"8"," me":"9","ing":"10","om ":"11"," ha":"12"," og":"13","ter":"14"," er":"15"," ti":"16"," st":"17","og ":"18","til":"19","ne ":"20"," vi":"21","re ":"22"," en":"23"," se":"24","te ":"25","or ":"26","de ":"27","kke":"28","ke ":"29","ar ":"30","ng ":"31","r s":"32","ene":"33"," so":"34","e s":"35","der":"36","an ":"37","som":"38","ste":"39","at ":"40","ed ":"41","r i":"42"," av":"43"," in":"44","men":"45"," at":"46"," ko":"47"," på":"48","har":"49"," si":"50","ere":"51","på ":"52","nde":"53","and":"54","els":"55","ett":"56","tte":"57","lig":"58","t s":"59","den":"60","t i":"61","ikk":"62","med":"63","n s":"64","rt ":"65","ser":"66","ska":"67","t e":"68","ker":"69","sen":"70","av ":"71","ler":"72","r a":"73","ten":"74","e f":"75","r e":"76","r t":"77","ede":"78","ig ":"79"," re":"80","han":"81","lle":"82","ner":"83"," bl":"84"," fr":"85","le ":"86"," ve":"87","e t":"88","lan":"89","mme":"90","nge":"91"," be":"92"," ik":"93"," om":"94"," å ":"95","ell":"96","sel":"97","sta":"98","ver":"99"," et":"100"," sk":"101","nte":"102","one":"103","ore":"104","r d":"105","ske":"106"," an":"107"," la":"108","del":"109","gen":"110","nin":"111","r f":"112","r v":"113","se ":"114"," po":"115","ir ":"116","jon":"117","mer":"118","nen":"119","omm":"120","sjo":"121"," fl":"122"," sa":"123","ern":"124","kom":"125","r m":"126","r o":"127","ren":"128","vil":"129","ale":"130","es ":"131","n a":"132","t f":"133"," le":"134","bli":"135","e e":"136","e i":"137","e v":"138","het":"139","ye ":"140"," ir":"141","al ":"142","e o":"143","ide":"144","iti":"145","lit":"146","nne":"147","ran":"148","t o":"149","tal":"150","tat":"151","tt ":"152"," ka":"153","ans":"154","asj":"155","ge ":"156","inn":"157","kon":"158","lse":"159","pet":"160","t d":"161","vi ":"162"," ut":"163","ent":"164","eri":"165","oli":"166","r p":"167","ret":"168","ris":"169","sto":"170","str":"171","t a":"172"," ga":"173","all":"174","ape":"175","g s":"176","ill":"177","ira":"178","kap":"179","nn ":"180","opp":"181","r h":"182","rin":"183"," br":"184"," op":"185","e m":"186","ert":"187","ger":"188","ion":"189","kal":"190","lsk":"191","nes":"192"," gj":"193"," mi":"194"," pr":"195","ang":"196","e h":"197","e r":"198","elt":"199","enn":"200","i s":"201","ist":"202","jen":"203","kan":"204","lt ":"205","nal":"206","res":"207","tor":"208","ass":"209","dre":"210","e b":"211","e p":"212","mel":"213","n t":"214","nse":"215","ort":"216","per":"217","reg":"218","sje":"219","t p":"220","t v":"221"," hv":"222"," nå":"223"," va":"224","ann":"225","ato":"226","e a":"227","est":"228","ise":"229","isk":"230","oil":"231","ord":"232","pol":"233","ra ":"234","rak":"235","sse":"236","toi":"237"," gr":"238","ak ":"239","eg ":"240","ele":"241","g a":"242","ige":"243","igh":"244","m e":"245","n f":"246","n v":"247","ndr":"248","nsk":"249","rer":"250","t m":"251","und":"252","var":"253","år ":"254"," he":"255"," no":"256"," ny":"257","end":"258","ete":"259","fly":"260","g i":"261","ghe":"262","ier":"263","ind":"264","int":"265","lin":"266","n d":"267","n p":"268","rne":"269","sak":"270","sie":"271","t b":"272","tid":"273"," al":"274"," pa":"275"," tr":"276","ag ":"277","dig":"278","e d":"279","e k":"280","ess":"281","hol":"282","i d":"283","lag":"284","led":"285","n e":"286","n i":"287","n o":"288","pri":"289","r b":"290","st ":"291"," fe":"292"," li":"293"," ry":"294","air":"295","ake":"296","d s":"297","eas":"298","egi":"299"},"pashto":{" د ":"0","اؤ ":"1"," اؤ":"2","نو ":"3","ې د":"4","ره ":"5"," په":"6","نه ":"7","چې ":"8"," چې":"9","په ":"10","ه د":"11","ته ":"12","و ا":"13","ونو":"14","و د":"15"," او":"16","انو":"17","ونه":"18","ه ک":"19"," دا":"20","ه ا":"21","دې ":"22","ښې ":"23"," کې":"24","ان ":"25","لو ":"26","هم ":"27","و م":"28","کښې":"29","ه م":"30","ى ا":"31"," نو":"32"," ته":"33"," کښ":"34","رون":"35","کې ":"36","ده ":"37","له ":"38","به ":"39","رو ":"40"," هم":"41","ه و":"42","وى ":"43","او ":"44","تون":"45","دا ":"46"," کو":"47"," کړ":"48","قام":"49"," تر":"50","ران":"51","ه پ":"52","ې و":"53","ې پ":"54"," به":"55"," خو":"56","تو ":"57","د د":"58","د ا":"59","ه ت":"60","و پ":"61","يا ":"62"," خپ":"63"," دو":"64"," را":"65"," مش":"66"," پر":"67","ارو":"68","رې ":"69","م د":"70","مشر":"71"," شو":"72"," ور":"73","ار ":"74","دى ":"75"," اد":"76"," دى":"77"," مو":"78","د پ":"79","لي ":"80","و ک":"81"," مق":"82"," يو":"83","ؤ د":"84","خپل":"85","سره":"86","ه چ":"87","ور ":"88"," تا":"89"," دې":"90"," رو":"91"," سر":"92"," مل":"93"," کا":"94","ؤ ا":"95","اره":"96","برو":"97","مه ":"98","ه ب":"99","و ت":"100","پښت":"101"," با":"102"," دغ":"103"," قب":"104"," له":"105"," وا":"106"," پا":"107"," پښ":"108","د م":"109","د ه":"110","لې ":"111","مات":"112","مو ":"113","ه ه":"114","وي ":"115","ې ب":"116","ې ک":"117"," ده":"118"," قا":"119","ال ":"120","اما":"121","د ن":"122","قبر":"123","ه ن":"124","پار":"125"," اث":"126"," بي":"127"," لا":"128"," لر":"129","اثا":"130","د خ":"131","دار":"132","ريخ":"133","شرا":"134","مقا":"135","نۍ ":"136","ه ر":"137","ه ل":"138","ولو":"139","يو ":"140","کوم":"141"," دد":"142"," لو":"143"," مح":"144"," مر":"145"," وو":"146","اتو":"147","اري":"148","الو":"149","اند":"150","خان":"151","د ت":"152","سې ":"153","لى ":"154","نور":"155","و ل":"156","ي چ":"157","ړي ":"158","ښتو":"159","ې ل":"160"," جو":"161"," سي":"162","ام ":"163","بان":"164","تار":"165","تر ":"166","ثار":"167","خو ":"168","دو ":"169","ر ک":"170","ل د":"171","مون":"172","ندې":"173","و ن":"174","ول ":"175","وه ":"176","ى و":"177","ي د":"178","ې ا":"179","ې ت":"180","ې ي":"181"," حک":"182"," خب":"183"," نه":"184"," پو":"185","ا د":"186","تې ":"187","جوړ":"188","حکم":"189","حکو":"190","خبر":"191","دان":"192","ر د":"193","غه ":"194","قاف":"195","محک":"196","وال":"197","ومت":"198","ويل":"199","ى د":"200","ى م":"201","يره":"202","پر ":"203","کول":"204","ې ه":"205"," تي":"206"," خا":"207"," وک":"208"," يا":"209"," ځا":"210","ؤ ق":"211","انۍ":"212","بى ":"213","غو ":"214","ه خ":"215","و ب":"216","ودا":"217","يدو":"218","ړې ":"219","کال":"220"," بر":"221"," قد":"222"," مي":"223"," وي":"224"," کر":"225","ؤ م":"226","ات ":"227","ايي":"228","تى ":"229","تيا":"230","تير":"231","خوا":"232","دغو":"233","دم ":"234","ديم":"235","ر و":"236","قدي":"237","م خ":"238","مان":"239","مې ":"240","نيو":"241","نږ ":"242","ه ي":"243","و س":"244","و چ":"245","وان":"246","ورو":"247","ونږ":"248","پور":"249","ړه ":"250","ړو ":"251","ۍ د":"252","ې ن":"253"," اه":"254"," زي":"255"," سو":"256"," شي":"257"," هر":"258"," هغ":"259"," ښا":"260","اتل":"261","اق ":"262","اني":"263","بري":"264","بې ":"265","ت ا":"266","د ب":"267","د س":"268","ر م":"269","رى ":"270","عرا":"271","لان":"272","مى ":"273","نى ":"274","و خ":"275","وئ ":"276","ورک":"277","ورې":"278","ون ":"279","وکړ":"280","ى چ":"281","يمه":"282","يې ":"283","ښتن":"284","که ":"285","کړي":"286","ې خ":"287","ے ش":"288"," تح":"289"," تو":"290"," در":"291"," دپ":"292"," صو":"293"," عر":"294"," ول":"295"," يؤ":"296"," پۀ":"297"," څو":"298","ا ا":"299"},"pidgin":{" de":"0"," we":"1"," di":"2","di ":"3","dem":"4","em ":"5","ay ":"6"," sa":"7","or ":"8","say":"9","ke ":"10","ey ":"11"," an":"12"," go":"13"," e ":"14"," to":"15"," ma":"16","e d":"17","wey":"18","for":"19","nd ":"20","to ":"21"," be":"22"," fo":"23","ake":"24","im ":"25"," pe":"26","le ":"27","go ":"28","ll ":"29","de ":"30","e s":"31","on ":"32","get":"33","ght":"34","igh":"35"," ri":"36","et ":"37","rig":"38"," ge":"39","y d":"40"," na":"41","mak":"42","t t":"43"," no":"44","and":"45","tin":"46","ing":"47","eve":"48","ri ":"49"," im":"50"," am":"51"," or":"52","am ":"53","be ":"54"," ev":"55"," ta":"56","ht ":"57","e w":"58"," li":"59","eri":"60","ng ":"61","ver":"62","all":"63","e f":"64","ers":"65","ntr":"66","ont":"67"," do":"68","r d":"69"," ko":"70"," ti":"71","an ":"72","kon":"73","per":"74","tri":"75","y e":"76","rso":"77","son":"78","no ":"79","ome":"80","is ":"81","do ":"82","ne ":"83","one":"84","ion":"85","m g":"86","i k":"87"," al":"88","bod":"89","i w":"90","odi":"91"," so":"92"," wo":"93","o d":"94","st ":"95","t r":"96"," of":"97","aim":"98","e g":"99","nai":"100"," co":"101","dis":"102","me ":"103","of ":"104"," wa":"105","e t":"106"," ar":"107","e l":"108","ike":"109","lik":"110","t a":"111","wor":"112","alk":"113","ell":"114","eop":"115","lk ":"116","opl":"117","peo":"118","ple":"119","re ":"120","tal":"121","any":"122","e a":"123","o g":"124","art":"125","cle":"126","i p":"127","icl":"128","rti":"129","the":"130","tic":"131","we ":"132","f d":"133","in ":"134"," mu":"135","e n":"136","e o":"137","mus":"138","n d":"139","na ":"140","o m":"141","ust":"142","wel":"143","e e":"144","her":"145","m d":"146","nt ":"147"," fi":"148","at ":"149","e b":"150","it ":"151","m w":"152","o t":"153","wan":"154","com":"155","da ":"156","fit":"157","m b":"158","so ":"159"," fr":"160","ce ":"161","er ":"162","o a":"163"," if":"164"," on":"165","ent":"166","if ":"167","ind":"168","kin":"169","l d":"170","man":"171","o s":"172"," se":"173","y a":"174","y m":"175"," re":"176","ee ":"177","k a":"178","t s":"179","ve ":"180","y w":"181"," ki":"182","eti":"183","men":"184","ta ":"185","y n":"186","d t":"187","dey":"188","e c":"189","i o":"190","ibo":"191","ld ":"192","m t":"193","n b":"194","o b":"195","ow ":"196","ree":"197","rio":"198","t d":"199"," hu":"200"," su":"201","en ":"202","hts":"203","ive":"204","m n":"205","n g":"206","ny ":"207","oth":"208","ts ":"209"," as":"210"," wh":"211","as ":"212","gom":"213","hum":"214","k s":"215","oda":"216","ork":"217","se ":"218","uma":"219","ut ":"220"," ba":"221"," ot":"222","ano":"223","m a":"224","m s":"225","nod":"226","om ":"227","r a":"228","r i":"229","rk ":"230"," fa":"231"," si":"232"," th":"233","ad ":"234","e m":"235","eac":"236","m m":"237","n w":"238","nob":"239","orl":"240","out":"241","own":"242","r s":"243","r w":"244","rib":"245","rld":"246","s w":"247","ure":"248","wn ":"249"," ow":"250","a d":"251","bad":"252","ch ":"253","fre":"254","gs ":"255","m k":"256","nce":"257","ngs":"258","o f":"259","obo":"260","rea":"261","sur":"262","y o":"263"," ab":"264"," un":"265","abo":"266","ach":"267","bou":"268","d m":"269","dat":"270","e p":"271","g w":"272","hol":"273","i m":"274","i r":"275","m f":"276","m o":"277","n o":"278","now":"279","ry ":"280","s a":"281","t o":"282","tay":"283","wet":"284"," ag":"285"," bo":"286"," da":"287"," pr":"288","arr":"289","ati":"290","d d":"291","d p":"292","i g":"293","i t":"294","liv":"295","ly ":"296","n a":"297","od ":"298","ok ":"299"},"polish":{"ie ":"0","nie":"1","em ":"2"," ni":"3"," po":"4"," pr":"5","dzi":"6"," na":"7","że ":"8","rze":"9","na ":"10","łem":"11","wie":"12"," w ":"13"," że":"14","go ":"15"," by":"16","prz":"17","owa":"18","ię ":"19"," do":"20"," si":"21","owi":"22"," pa":"23"," za":"24","ch ":"25","ego":"26","ał ":"27","się":"28","ej ":"29","wał":"30","ym ":"31","ani":"32","ałe":"33","to ":"34"," i ":"35"," to":"36"," te":"37","e p":"38"," je":"39"," z ":"40","czy":"41","był":"42","pan":"43","sta":"44","kie":"45"," ja":"46","do ":"47"," ch":"48"," cz":"49"," wi":"50","iał":"51","a p":"52","pow":"53"," mi":"54","li ":"55","eni":"56","zie":"57"," ta":"58"," wa":"59","ło ":"60","ać ":"61","dy ":"62","ak ":"63","e w":"64"," a ":"65"," od":"66"," st":"67","nia":"68","rzy":"69","ied":"70"," kt":"71","odz":"72","cie":"73","cze":"74","ia ":"75","iel":"76","któ":"77","o p":"78","tór":"79","ści":"80"," sp":"81"," wy":"82","jak":"83","tak":"84","zy ":"85"," mo":"86","ałę":"87","pro":"88","ski":"89","tem":"90","łęs":"91"," tr":"92","e m":"93","jes":"94","my ":"95"," ro":"96","edz":"97","eli":"98","iej":"99"," rz":"100","a n":"101","ale":"102","an ":"103","e s":"104","est":"105","le ":"106","o s":"107","i p":"108","ki ":"109"," co":"110","ada":"111","czn":"112","e t":"113","e z":"114","ent":"115","ny ":"116","pre":"117","rzą":"118","y s":"119"," ko":"120"," o ":"121","ach":"122","am ":"123","e n":"124","o t":"125","oli":"126","pod":"127","zia":"128"," go":"129"," ka":"130","by ":"131","ieg":"132","ier":"133","noś":"134","roz":"135","spo":"136","ych":"137","ząd":"138"," mn":"139","acz":"140","adz":"141","bie":"142","cho":"143","mni":"144","o n":"145","ost":"146","pra":"147","ze ":"148","ła ":"149"," so":"150","a m":"151","cza":"152","iem":"153","ić ":"154","obi":"155","ył ":"156","yło":"157"," mu":"158"," mó":"159","a t":"160","acj":"161","ci ":"162","e b":"163","ich":"164","kan":"165","mi ":"166","mie":"167","ośc":"168","row":"169","zen":"170","zyd":"171"," al":"172"," re":"173","a w":"174","den":"175","edy":"176","ił ":"177","ko ":"178","o w":"179","rac":"180","śmy":"181"," ma":"182"," ra":"183"," sz":"184"," ty":"185","e j":"186","isk":"187","ji ":"188","ka ":"189","m s":"190","no ":"191","o z":"192","rez":"193","wa ":"194","ów ":"195","łow":"196","ść ":"197"," ob":"198","ech":"199","ecz":"200","ezy":"201","i w":"202","ja ":"203","kon":"204","mów":"205","ne ":"206","ni ":"207","now":"208","nym":"209","pol":"210","pot":"211","yde":"212"," dl":"213"," sy":"214","a s":"215","aki":"216","ali":"217","dla":"218","icz":"219","ku ":"220","ocz":"221","st ":"222","str":"223","szy":"224","trz":"225","wia":"226","y p":"227","za ":"228"," wt":"229","chc":"230","esz":"231","iec":"232","im ":"233","la ":"234","o m":"235","sa ":"236","wać":"237","y n":"238","zac":"239","zec":"240"," gd":"241","a z":"242","ard":"243","co ":"244","dar":"245","e r":"246","ien":"247","m n":"248","m w":"249","mia":"250","moż":"251","raw":"252","rdz":"253","tan":"254","ted":"255","teg":"256","wił":"257","wte":"258","y z":"259","zna":"260","zło":"261","a r":"262","awi":"263","bar":"264","cji":"265","czą":"266","dow":"267","eż ":"268","gdy":"269","iek":"270","je ":"271","o d":"272","tał":"273","wal":"274","wsz":"275","zed":"276","ówi":"277","ęsa":"278"," ba":"279"," lu":"280"," wo":"281","aln":"282","arn":"283","ba ":"284","dzo":"285","e c":"286","hod":"287","igi":"288","lig":"289","m p":"290","myś":"291","o c":"292","oni":"293","rel":"294","sku":"295","ste":"296","y w":"297","yst":"298","z w":"299"},"portuguese":{"de ":"0"," de":"1","os ":"2","as ":"3","que":"4"," co":"5","ão ":"6","o d":"7"," qu":"8","ue ":"9"," a ":"10","do ":"11","ent":"12"," se":"13","a d":"14","s d":"15","e a":"16","es ":"17"," pr":"18","ra ":"19","da ":"20"," es":"21"," pa":"22","to ":"23"," o ":"24","em ":"25","con":"26","o p":"27"," do":"28","est":"29","nte":"30","ção":"31"," da":"32"," re":"33","ma ":"34","par":"35"," te":"36","ara":"37","ida":"38"," e ":"39","ade":"40","is ":"41"," um":"42"," po":"43","a a":"44","a p":"45","dad":"46","no ":"47","te ":"48"," no":"49","açã":"50","pro":"51","al ":"52","com":"53","e d":"54","s a":"55"," as":"56","a c":"57","er ":"58","men":"59","s e":"60","ais":"61","nto":"62","res":"63","a s":"64","ado":"65","ist":"66","s p":"67","tem":"68","e c":"69","e s":"70","ia ":"71","o s":"72","o a":"73","o c":"74","e p":"75","sta":"76","ta ":"77","tra":"78","ura":"79"," di":"80"," pe":"81","ar ":"82","e e":"83","ser":"84","uma":"85","mos":"86","se ":"87"," ca":"88","o e":"89"," na":"90","a e":"91","des":"92","ont":"93","por":"94"," in":"95"," ma":"96","ect":"97","o q":"98","ria":"99","s c":"100","ste":"101","ver":"102","cia":"103","dos":"104","ica":"105","str":"106"," ao":"107"," em":"108","das":"109","e t":"110","ito":"111","iza":"112","pre":"113","tos":"114"," nã":"115","ada":"116","não":"117","ess":"118","eve":"119","or ":"120","ran":"121","s n":"122","s t":"123","tur":"124"," ac":"125"," fa":"126","a r":"127","ens":"128","eri":"129","na ":"130","sso":"131"," si":"132"," é ":"133","bra":"134","esp":"135","mo ":"136","nos":"137","ro ":"138","um ":"139","a n":"140","ao ":"141","ico":"142","liz":"143","min":"144","o n":"145","ons":"146","pri":"147","ten":"148","tic":"149","ões":"150"," tr":"151","a m":"152","aga":"153","e n":"154","ili":"155","ime":"156","m a":"157","nci":"158","nha":"159","nta":"160","spe":"161","tiv":"162","am ":"163","ano":"164","arc":"165","ass":"166","cer":"167","e o":"168","ece":"169","emo":"170","ga ":"171","o m":"172","rag":"173","so ":"174","são":"175"," au":"176"," os":"177"," sa":"178","ali":"179","ca ":"180","ema":"181","emp":"182","ici":"183","ido":"184","inh":"185","iss":"186","l d":"187","la ":"188","lic":"189","m c":"190","mai":"191","onc":"192","pec":"193","ram":"194","s q":"195"," ci":"196"," en":"197"," fo":"198","a o":"199","ame":"200","car":"201","co ":"202","der":"203","eir":"204","ho ":"205","io ":"206","om ":"207","ora":"208","r a":"209","sen":"210","ter":"211"," br":"212"," ex":"213","a u":"214","cul":"215","dev":"216","e u":"217","ha ":"218","mpr":"219","nce":"220","oca":"221","ove":"222","rio":"223","s o":"224","sa ":"225","sem":"226","tes":"227","uni":"228","ven":"229","zaç":"230","çõe":"231"," ad":"232"," al":"233"," an":"234"," mi":"235"," mo":"236"," ve":"237"," à ":"238","a i":"239","a q":"240","ala":"241","amo":"242","bli":"243","cen":"244","col":"245","cos":"246","cto":"247","e m":"248","e v":"249","ede":"250","gás":"251","ias":"252","ita":"253","iva":"254","ndo":"255","o t":"256","ore":"257","r d":"258","ral":"259","rea":"260","s f":"261","sid":"262","tro":"263","vel":"264","vid":"265","ás ":"266"," ap":"267"," ar":"268"," ce":"269"," ou":"270"," pú":"271"," so":"272"," vi":"273","a f":"274","act":"275","arr":"276","bil":"277","cam":"278","e f":"279","e i":"280","el ":"281","for":"282","lem":"283","lid":"284","lo ":"285","m d":"286","mar":"287","nde":"288","o o":"289","omo":"290","ort":"291","per":"292","púb":"293","r u":"294","rei":"295","rem":"296","ros":"297","rre":"298","ssi":"299"},"romanian":{" de":"0"," în":"1","de ":"2"," a ":"3","ul ":"4"," co":"5","în ":"6","re ":"7","e d":"8","ea ":"9"," di":"10"," pr":"11","le ":"12","şi ":"13","are":"14","at ":"15","con":"16","ui ":"17"," şi":"18","i d":"19","ii ":"20"," cu":"21","e a":"22","lui":"23","ern":"24","te ":"25","cu ":"26"," la":"27","a c":"28","că ":"29","din":"30","e c":"31","or ":"32","ulu":"33","ne ":"34","ter":"35","la ":"36","să ":"37","tat":"38","tre":"39"," ac":"40"," să":"41","est":"42","st ":"43","tă ":"44"," ca":"45"," ma":"46"," pe":"47","cur":"48","ist":"49","mân":"50","a d":"51","i c":"52","nat":"53"," ce":"54","i a":"55","ia ":"56","in ":"57","scu":"58"," mi":"59","ato":"60","aţi":"61","ie ":"62"," re":"63"," se":"64","a a":"65","int":"66","ntr":"67","tru":"68","uri":"69","ă a":"70"," fo":"71"," pa":"72","ate":"73","ini":"74","tul":"75","ent":"76","min":"77","pre":"78","pro":"79","a p":"80","e p":"81","e s":"82","ei ":"83","nă ":"84","par":"85","rna":"86","rul":"87","tor":"88"," in":"89"," ro":"90"," tr":"91"," un":"92","al ":"93","ale":"94","art":"95","ce ":"96","e e":"97","e î":"98","fos":"99","ita":"100","nte":"101","omâ":"102","ost":"103","rom":"104","ru ":"105","str":"106","ver":"107"," ex":"108"," na":"109","a f":"110","lor":"111","nis":"112","rea":"113","rit":"114"," al":"115"," eu":"116"," no":"117","ace":"118","cer":"119","ile":"120","nal":"121","pri":"122","ri ":"123","sta":"124","ste":"125","ţie":"126"," au":"127"," da":"128"," ju":"129"," po":"130","ar ":"131","au ":"132","ele":"133","ere":"134","eri":"135","ina":"136","n a":"137","n c":"138","res":"139","se ":"140","t a":"141","tea":"142"," că":"143"," do":"144"," fi":"145","a s":"146","ată":"147","com":"148","e ş":"149","eur":"150","guv":"151","i s":"152","ice":"153","ili":"154","na ":"155","rec":"156","rep":"157","ril":"158","rne":"159","rti":"160","uro":"161","uve":"162","ă p":"163"," ar":"164"," o ":"165"," su":"166"," vi":"167","dec":"168","dre":"169","oar":"170","ons":"171","pe ":"172","rii":"173"," ad":"174"," ge":"175","a m":"176","a r":"177","ain":"178","ali":"179","car":"180","cat":"181","ecu":"182","ene":"183","ept":"184","ext":"185","ilo":"186","iu ":"187","n p":"188","ori":"189","sec":"190","u p":"191","une":"192","ă c":"193","şti":"194","ţia":"195"," ch":"196"," gu":"197","ai ":"198","ani":"199","cea":"200","e f":"201","isc":"202","l a":"203","lic":"204","liu":"205","mar":"206","nic":"207","nt ":"208","nul":"209","ris":"210","t c":"211","t p":"212","tic":"213","tid":"214","u a":"215","ucr":"216"," as":"217"," dr":"218"," fa":"219"," nu":"220"," pu":"221"," to":"222","cra":"223","dis":"224","enţ":"225","esc":"226","gen":"227","it ":"228","ivi":"229","l d":"230","n d":"231","nd ":"232","nu ":"233","ond":"234","pen":"235","ral":"236","riv":"237","rte":"238","sti":"239","t d":"240","ta ":"241","to ":"242","uni":"243","xte":"244","ând":"245","îns":"246","ă s":"247"," bl":"248"," st":"249"," uc":"250","a b":"251","a i":"252","a l":"253","air":"254","ast":"255","bla":"256","bri":"257","che":"258","duc":"259","dul":"260","e m":"261","eas":"262","edi":"263","esp":"264","i l":"265","i p":"266","ica":"267","ică":"268","ir ":"269","iun":"270","jud":"271","lai":"272","lul":"273","mai":"274","men":"275","ni ":"276","pus":"277","put":"278","ra ":"279","rai":"280","rop":"281","sil":"282","ti ":"283","tra":"284","u s":"285","ua ":"286","ude":"287","urs":"288","ân ":"289","înt":"290","ţă ":"291"," lu":"292"," mo":"293"," s ":"294"," sa":"295"," sc":"296","a u":"297","an ":"298","atu":"299"},"russian":{" на":"0"," пр":"1","то ":"2"," не":"3","ли ":"4"," по":"5","но ":"6"," в ":"7","на ":"8","ть ":"9","не ":"10"," и ":"11"," ко":"12","ом ":"13","про":"14"," то":"15","их ":"16"," ка":"17","ать":"18","ото":"19"," за":"20","ие ":"21","ова":"22","тел":"23","тор":"24"," де":"25","ой ":"26","сти":"27"," от":"28","ах ":"29","ми ":"30","стр":"31"," бе":"32"," во":"33"," ра":"34","ая ":"35","ват":"36","ей ":"37","ет ":"38","же ":"39","иче":"40","ия ":"41","ов ":"42","сто":"43"," об":"44","вер":"45","го ":"46","и в":"47","и п":"48","и с":"49","ии ":"50","ист":"51","о в":"52","ост":"53","тра":"54"," те":"55","ели":"56","ере":"57","кот":"58","льн":"59","ник":"60","нти":"61","о с":"62","рор":"63","ств":"64","чес":"65"," бо":"66"," ве":"67"," да":"68"," ин":"69"," но":"70"," с ":"71"," со":"72"," сп":"73"," ст":"74"," чт":"75","али":"76","ами":"77","вид":"78","дет":"79","е н":"80","ель":"81","еск":"82","ест":"83","зал":"84","и н":"85","ива":"86","кон":"87","ого":"88","одн":"89","ожн":"90","оль":"91","ори":"92","ров":"93","ско":"94","ся ":"95","тер":"96","что":"97"," мо":"98"," са":"99"," эт":"100","ант":"101","все":"102","ерр":"103","есл":"104","иде":"105","ина":"106","ино":"107","иро":"108","ите":"109","ка ":"110","ко ":"111","кол":"112","ком":"113","ла ":"114","ния":"115","о т":"116","оло":"117","ран":"118","ред":"119","сь ":"120","тив":"121","тич":"122","ых ":"123"," ви":"124"," вс":"125"," го":"126"," ма":"127"," сл":"128","ако":"129","ани":"130","аст":"131","без":"132","дел":"133","е д":"134","е п":"135","ем ":"136","жно":"137","и д":"138","ика":"139","каз":"140","как":"141","ки ":"142","нос":"143","о н":"144","опа":"145","при":"146","рро":"147","ски":"148","ти ":"149","тов":"150","ые ":"151"," вы":"152"," до":"153"," ме":"154"," ни":"155"," од":"156"," ро":"157"," св":"158"," чи":"159","а н":"160","ает":"161","аза":"162","ате":"163","бес":"164","в п":"165","ва ":"166","е в":"167","е м":"168","е с":"169","ез ":"170","ени":"171","за ":"172","зна":"173","ини":"174","кам":"175","ках":"176","кто":"177","лов":"178","мер":"179","мож":"180","нал":"181","ниц":"182","ны ":"183","ным":"184","ора":"185","оро":"186","от ":"187","пор":"188","рав":"189","рес":"190","рис":"191","рос":"192","ска":"193","т н":"194","том":"195","чит":"196","шко":"197"," бы":"198"," о ":"199"," тр":"200"," уж":"201"," чу":"202"," шк":"203","а б":"204","а в":"205","а р":"206","аби":"207","ала":"208","ало":"209","аль":"210","анн":"211","ати":"212","бин":"213","вес":"214","вно":"215","во ":"216","вши":"217","дал":"218","дат":"219","дно":"220","е з":"221","его":"222","еле":"223","енн":"224","ент":"225","ете":"226","и о":"227","или":"228","ись":"229","ит ":"230","ици":"231","ков":"232","лен":"233","льк":"234","мен":"235","мы ":"236","нет":"237","ни ":"238","нны":"239","ног":"240","ной":"241","ном":"242","о п":"243","обн":"244","ове":"245","овн":"246","оры":"247","пер":"248","по ":"249","пра":"250","пре":"251","раз":"252","роп":"253","ры ":"254","се ":"255","сли":"256","сов":"257","тре":"258","тся":"259","уро":"260","цел":"261","чно":"262","ь в":"263","ько":"264","ьно":"265","это":"266","ют ":"267","я н":"268"," ан":"269"," ес":"270"," же":"271"," из":"272"," кт":"273"," ми":"274"," мы":"275"," пе":"276"," се":"277"," це":"278","а м":"279","а п":"280","а т":"281","авш":"282","аже":"283","ак ":"284","ал ":"285","але":"286","ане":"287","ачи":"288","ают":"289","бна":"290","бол":"291","бы ":"292","в и":"293","в с":"294","ван":"295","гра":"296","даж":"297","ден":"298","е к":"299"},"serbian":{" на":"0"," је":"1"," по":"2","је ":"3"," и ":"4"," не":"5"," пр":"6","га ":"7"," св":"8","ог ":"9","а с":"10","их ":"11","на ":"12","кој":"13","ога":"14"," у ":"15","а п":"16","не ":"17","ни ":"18","ти ":"19"," да":"20","ом ":"21"," ве":"22"," ср":"23","и с":"24","ско":"25"," об":"26","а н":"27","да ":"28","е н":"29","но ":"30","ног":"31","о ј":"32","ој ":"33"," за":"34","ва ":"35","е с":"36","и п":"37","ма ":"38","ник":"39","обр":"40","ова":"41"," ко":"42","а и":"43","диј":"44","е п":"45","ка ":"46","ко ":"47","ког":"48","ост":"49","све":"50","ств":"51","сти":"52","тра":"53","еди":"54","има":"55","пок":"56","пра":"57","раз":"58","те ":"59"," бо":"60"," ви":"61"," са":"62","аво":"63","бра":"64","гос":"65","е и":"66","ели":"67","ени":"68","за ":"69","ики":"70","ио ":"71","пре":"72","рав":"73","рад":"74","у с":"75","ју ":"76","ња ":"77"," би":"78"," до":"79"," ст":"80","аст":"81","бој":"82","ебо":"83","и н":"84","им ":"85","ку ":"86","лан":"87","неб":"88","ово":"89","ого":"90","осл":"91","ојш":"92","пед":"93","стр":"94","час":"95"," го":"96"," кр":"97"," мо":"98"," чл":"99","а м":"100","а о":"101","ако":"102","ача":"103","вел":"104","вет":"105","вог":"106","еда":"107","ист":"108","ити":"109","ије":"110","око":"111","сло":"112","срб":"113","чла":"114"," бе":"115"," ос":"116"," от":"117"," ре":"118"," се":"119","а в":"120","ан ":"121","бог":"122","бро":"123","вен":"124","гра":"125","е о":"126","ика":"127","ија":"128","ких":"129","ком":"130","ли ":"131","ну ":"132","ота":"133","ојн":"134","под":"135","рбс":"136","ред":"137","рој":"138","са ":"139","сни":"140","тач":"141","тва":"142","ја ":"143","ји ":"144"," ка":"145"," ов":"146"," тр":"147","а ј":"148","ави":"149","аз ":"150","ано":"151","био":"152","вик":"153","во ":"154","гов":"155","дни":"156","е ч":"157","его":"158","и о":"159","ива":"160","иво":"161","ик ":"162","ине":"163","ини":"164","ипе":"165","кип":"166","лик":"167","ло ":"168","наш":"169","нос":"170","о т":"171","од ":"172","оди":"173","она":"174","оји":"175","поч":"176","про":"177","ра ":"178","рис":"179","род":"180","рст":"181","се ":"182","спо":"183","ста":"184","тић":"185","у д":"186","у н":"187","у о":"188","чин":"189","ша ":"190","јед":"191","јни":"192","ће ":"193"," м ":"194"," ме":"195"," ни":"196"," он":"197"," па":"198"," сл":"199"," те":"200","а у":"201","ава":"202","аве":"203","авн":"204","ана":"205","ао ":"206","ати":"207","аци":"208","ају":"209","ања":"210","бск":"211","вор":"212","вос":"213","вск":"214","дин":"215","е у":"216","едн":"217","ези":"218","ека":"219","ено":"220","ето":"221","ења":"222","жив":"223","и г":"224","и и":"225","и к":"226","и т":"227","ику":"228","ичк":"229","ки ":"230","крс":"231","ла ":"232","лав":"233","лит":"234","ме ":"235","мен":"236","нац":"237","о н":"238","о п":"239","о у":"240","одн":"241","оли":"242","орн":"243","осн":"244","осп":"245","оче":"246","пск":"247","реч":"248","рпс":"249","сво":"250","ски":"251","сла":"252","срп":"253","су ":"254","та ":"255","тав":"256","тве":"257","у б":"258","јез":"259","ћи ":"260"," ен":"261"," жи":"262"," им":"263"," му":"264"," од":"265"," су":"266"," та":"267"," хр":"268"," ча":"269"," шт":"270"," ње":"271","а д":"272","а з":"273","а к":"274","а т":"275","аду":"276","ало":"277","ани":"278","асо":"279","ван":"280","вач":"281","вањ":"282","вед":"283","ви ":"284","вно":"285","вот":"286","вој":"287","ву ":"288","доб":"289","дру":"290","дсе":"291","ду ":"292","е б":"293","е д":"294","е м":"295","ем ":"296","ема":"297","ент":"298","енц":"299"},"slovak":{" pr":"0"," po":"1"," ne":"2"," a ":"3","ch ":"4"," na":"5"," je":"6","ní ":"7","je ":"8"," do":"9","na ":"10","ova":"11"," v ":"12","to ":"13","ho ":"14","ou ":"15"," to":"16","ick":"17","ter":"18","že ":"19"," st":"20"," za":"21","ost":"22","ých":"23"," se":"24","pro":"25"," te":"26","e s":"27"," že":"28","a p":"29"," kt":"30","pre":"31"," by":"32"," o ":"33","se ":"34","kon":"35"," př":"36","a s":"37","né ":"38","ně ":"39","sti":"40","ako":"41","ist":"42","mu ":"43","ame":"44","ent":"45","ky ":"46","la ":"47","pod":"48"," ve":"49"," ob":"50","om ":"51","vat":"52"," ko":"53","sta":"54","em ":"55","le ":"56","a v":"57","by ":"58","e p":"59","ko ":"60","eri":"61","kte":"62","sa ":"63","ého":"64","e v":"65","mer":"66","tel":"67"," ak":"68"," sv":"69"," zá":"70","hla":"71","las":"72","lo ":"73"," ta":"74","a n":"75","ej ":"76","li ":"77","ne ":"78"," sa":"79","ak ":"80","ani":"81","ate":"82","ia ":"83","sou":"84"," so":"85","ení":"86","ie ":"87"," re":"88","ce ":"89","e n":"90","ori":"91","tic":"92"," vy":"93","a t":"94","ké ":"95","nos":"96","o s":"97","str":"98","ti ":"99","uje":"100"," sp":"101","lov":"102","o p":"103","oli":"104","ová":"105"," ná":"106","ale":"107","den":"108","e o":"109","ku ":"110","val":"111"," am":"112"," ro":"113"," si":"114","nie":"115","pol":"116","tra":"117"," al":"118","ali":"119","o v":"120","tor":"121"," mo":"122"," ni":"123","ci ":"124","o n":"125","ím ":"126"," le":"127"," pa":"128"," s ":"129","al ":"130","ati":"131","ero":"132","ove":"133","rov":"134","ván":"135","ích":"136"," ja":"137"," z ":"138","cké":"139","e z":"140"," od":"141","byl":"142","de ":"143","dob":"144","nep":"145","pra":"146","ric":"147","spo":"148","tak":"149"," vš":"150","a a":"151","e t":"152","lit":"153","me ":"154","nej":"155","no ":"156","nýc":"157","o t":"158","a j":"159","e a":"160","en ":"161","est":"162","jí ":"163","mi ":"164","slo":"165","stá":"166","u v":"167","for":"168","nou":"169","pos":"170","pře":"171","si ":"172","tom":"173"," vl":"174","a z":"175","ly ":"176","orm":"177","ris":"178","za ":"179","zák":"180"," k ":"181","at ":"182","cký":"183","dno":"184","dos":"185","dy ":"186","jak":"187","kov":"188","ny ":"189","res":"190","ror":"191","sto":"192","van":"193"," op":"194","da ":"195","do ":"196","e j":"197","hod":"198","len":"199","ný ":"200","o z":"201","poz":"202","pri":"203","ran":"204","u s":"205"," ab":"206","aj ":"207","ast":"208","it ":"209","kto":"210","o o":"211","oby":"212","odo":"213","u p":"214","va ":"215","ání":"216","í p":"217","ým ":"218"," in":"219"," mi":"220","ať ":"221","dov":"222","ka ":"223","nsk":"224","áln":"225"," an":"226"," bu":"227"," sl":"228"," tr":"229","e m":"230","ech":"231","edn":"232","i n":"233","kýc":"234","níc":"235","ov ":"236","pří":"237","í a":"238"," aj":"239"," bo":"240","a d":"241","ide":"242","o a":"243","o d":"244","och":"245","pov":"246","svo":"247","é s":"248"," kd":"249"," vo":"250"," vý":"251","bud":"252","ich":"253","il ":"254","ili":"255","ni ":"256","ním":"257","od ":"258","osl":"259","ouh":"260","rav":"261","roz":"262","st ":"263","stv":"264","tu ":"265","u a":"266","vál":"267","y s":"268","í s":"269","í v":"270"," hl":"271"," li":"272"," me":"273","a m":"274","e b":"275","h s":"276","i p":"277","i s":"278","iti":"279","lád":"280","nem":"281","nov":"282","opo":"283","uhl":"284","eno":"285","ens":"286","men":"287","nes":"288","obo":"289","te ":"290","ved":"291","vlá":"292","y n":"293"," ma":"294"," mu":"295"," vá":"296","bez":"297","byv":"298","cho":"299"},"slovene":{"je ":"0"," pr":"1"," po":"2"," je":"3"," v ":"4"," za":"5"," na":"6","pre":"7","da ":"8"," da":"9","ki ":"10","ti ":"11","ja ":"12","ne ":"13"," in":"14","in ":"15","li ":"16","no ":"17","na ":"18","ni ":"19"," bi":"20","jo ":"21"," ne":"22","nje":"23","e p":"24","i p":"25","pri":"26","o p":"27","red":"28"," do":"29","anj":"30","em ":"31","ih ":"32"," bo":"33"," ki":"34"," iz":"35"," se":"36"," so":"37","al ":"38"," de":"39","e v":"40","i s":"41","ko ":"42","bil":"43","ira":"44","ove":"45"," br":"46"," ob":"47","e b":"48","i n":"49","ova":"50","se ":"51","za ":"52","la ":"53"," ja":"54","ati":"55","so ":"56","ter":"57"," ta":"58","a s":"59","del":"60","e d":"61"," dr":"62"," od":"63","a n":"64","ar ":"65","jal":"66","ji ":"67","rit":"68"," ka":"69"," ko":"70"," pa":"71","a b":"72","ani":"73","e s":"74","er ":"75","ili":"76","lov":"77","o v":"78","tov":"79"," ir":"80"," ni":"81"," vo":"82","a j":"83","bi ":"84","bri":"85","iti":"86","let":"87","o n":"88","tan":"89","še ":"90"," le":"91"," te":"92","eni":"93","eri":"94","ita":"95","kat":"96","por":"97","pro":"98","ali":"99","ke ":"100","oli":"101","ov ":"102","pra":"103","ri ":"104","uar":"105","ve ":"106"," to":"107","a i":"108","a v":"109","ako":"110","arj":"111","ate":"112","di ":"113","do ":"114","ga ":"115","le ":"116","lo ":"117","mer":"118","o s":"119","oda":"120","oro":"121","pod":"122"," ma":"123"," mo":"124"," si":"125","a p":"126","bod":"127","e n":"128","ega":"129","ju ":"130","ka ":"131","lje":"132","rav":"133","ta ":"134","a o":"135","e t":"136","e z":"137","i d":"138","i v":"139","ila":"140","lit":"141","nih":"142","odo":"143","sti":"144","to ":"145","var":"146","ved":"147","vol":"148"," la":"149"," no":"150"," vs":"151","a d":"152","agu":"153","aja":"154","dej":"155","dnj":"156","eda":"157","gov":"158","gua":"159","jag":"160","jem":"161","kon":"162","ku ":"163","nij":"164","omo":"165","oči":"166","pov":"167","rak":"168","rja":"169","sta":"170","tev":"171","a t":"172","aj ":"173","ed ":"174","eja":"175","ent":"176","ev ":"177","i i":"178","i o":"179","ijo":"180","ist":"181","ost":"182","ske":"183","str":"184"," ra":"185"," s ":"186"," tr":"187"," še":"188","arn":"189","bo ":"190","drž":"191","i j":"192","ilo":"193","izv":"194","jen":"195","lja":"196","nsk":"197","o d":"198","o i":"199","om ":"200","ora":"201","ovo":"202","raz":"203","rža":"204","tak":"205","va ":"206","ven":"207","žav":"208"," me":"209"," če":"210","ame":"211","avi":"212","e i":"213","e o":"214","eka":"215","gre":"216","i t":"217","ija":"218","il ":"219","ite":"220","kra":"221","lju":"222","mor":"223","nik":"224","o t":"225","obi":"226","odn":"227","ran":"228","re ":"229","sto":"230","stv":"231","udi":"232","v i":"233","van":"234"," am":"235"," sp":"236"," st":"237"," tu":"238"," ve":"239"," že":"240","ajo":"241","ale":"242","apo":"243","dal":"244","dru":"245","e j":"246","edn":"247","ejo":"248","elo":"249","est":"250","etj":"251","eva":"252","iji":"253","ik ":"254","im ":"255","itv":"256","mob":"257","nap":"258","nek":"259","pol":"260","pos":"261","rat":"262","ski":"263","tič":"264","tom":"265","ton":"266","tra":"267","tud":"268","tve":"269","v b":"270","vil":"271","vse":"272","čit":"273"," av":"274"," gr":"275","a z":"276","ans":"277","ast":"278","avt":"279","dan":"280","e m":"281","eds":"282","for":"283","i z":"284","kot":"285","mi ":"286","nim":"287","o b":"288","o o":"289","od ":"290","odl":"291","oiz":"292","ot ":"293","par":"294","pot":"295","rje":"296","roi":"297","tem":"298","val":"299"},"somali":{"ka ":"0","ay ":"1","da ":"2"," ay":"3","aal":"4","oo ":"5","aan":"6"," ka":"7","an ":"8","in ":"9"," in":"10","ada":"11","maa":"12","aba":"13"," so":"14","ali":"15","bad":"16","add":"17","soo":"18"," na":"19","aha":"20","ku ":"21","ta ":"22"," wa":"23","yo ":"24","a s":"25","oma":"26","yaa":"27"," ba":"28"," ku":"29"," la":"30"," oo":"31","iya":"32","sha":"33","a a":"34","dda":"35","nab":"36","nta":"37"," da":"38"," ma":"39","nka":"40","uu ":"41","y i":"42","aya":"43","ha ":"44","raa":"45"," dh":"46"," qa":"47","a k":"48","ala":"49","baa":"50","doo":"51","had":"52","liy":"53","oom":"54"," ha":"55"," sh":"56","a d":"57","a i":"58","a n":"59","aar":"60","ee ":"61","ey ":"62","y k":"63","ya ":"64"," ee":"65"," iy":"66","aa ":"67","aaq":"68","gaa":"69","lam":"70"," bu":"71","a b":"72","a m":"73","ad ":"74","aga":"75","ama":"76","iyo":"77","la ":"78","a c":"79","a l":"80","een":"81","int":"82","she":"83","wax":"84","yee":"85"," si":"86"," uu":"87","a h":"88","aas":"89","alk":"90","dha":"91","gu ":"92","hee":"93","ii ":"94","ira":"95","mad":"96","o a":"97","o k":"98","qay":"99"," ah":"100"," ca":"101"," wu":"102","ank":"103","ash":"104","axa":"105","eed":"106","en ":"107","ga ":"108","haa":"109","n a":"110","n s":"111","naa":"112","nay":"113","o d":"114","taa":"115","u b":"116","uxu":"117","wux":"118","xuu":"119"," ci":"120"," do":"121"," ho":"122"," ta":"123","a g":"124","a u":"125","ana":"126","ayo":"127","dhi":"128","iin":"129","lag":"130","lin":"131","lka":"132","o i":"133","san":"134","u s":"135","una":"136","uun":"137"," ga":"138"," xa":"139"," xu":"140","aab":"141","abt":"142","aq ":"143","aqa":"144","ara":"145","arl":"146","caa":"147","cir":"148","eeg":"149","eel":"150","isa":"151","kal":"152","lah":"153","ney":"154","qaa":"155","rla":"156","sad":"157","sii":"158","u d":"159","wad":"160"," ad":"161"," ar":"162"," di":"163"," jo":"164"," ra":"165"," sa":"166"," u ":"167"," yi":"168","a j":"169","a q":"170","aad":"171","aat":"172","aay":"173","ah ":"174","ale":"175","amk":"176","ari":"177","as ":"178","aye":"179","bus":"180","dal":"181","ddu":"182","dii":"183","du ":"184","duu":"185","ed ":"186","ege":"187","gey":"188","hay":"189","hii":"190","ida":"191","ine":"192","joo":"193","laa":"194","lay":"195","mar":"196","mee":"197","n b":"198","n d":"199","n m":"200","no ":"201","o b":"202","o l":"203","oog":"204","oon":"205","rga":"206","sh ":"207","sid":"208","u q":"209","unk":"210","ush":"211","xa ":"212","y d":"213"," bi":"214"," gu":"215"," is":"216"," ke":"217"," lo":"218"," me":"219"," mu":"220"," qo":"221"," ug":"222","a e":"223","a o":"224","a w":"225","adi":"226","ado":"227","agu":"228","al ":"229","ant":"230","ark":"231","asa":"232","awi":"233","bta":"234","bul":"235","d a":"236","dag":"237","dan":"238","do ":"239","e s":"240","gal":"241","gay":"242","guu":"243","h e":"244","hal":"245","iga":"246","ihi":"247","iri":"248","iye":"249","ken":"250","lad":"251","lid":"252","lsh":"253","mag":"254","mun":"255","n h":"256","n i":"257","na ":"258","o n":"259","o w":"260","ood":"261","oor":"262","ora":"263","qab":"264","qor":"265","rab":"266","rit":"267","rta":"268","s o":"269","sab":"270","ska":"271","to ":"272","u a":"273","u h":"274","u u":"275","ud ":"276","ugu":"277","uls":"278","uud":"279","waa":"280","xus":"281","y b":"282","y q":"283","y s":"284","yad":"285","yay":"286","yih":"287"," aa":"288"," bo":"289"," br":"290"," go":"291"," ji":"292"," mi":"293"," of":"294"," ti":"295"," um":"296"," wi":"297"," xo":"298","a x":"299"},"spanish":{" de":"0","de ":"1"," la":"2","os ":"3","la ":"4","el ":"5","es ":"6"," qu":"7"," co":"8","e l":"9","as ":"10","que":"11"," el":"12","ue ":"13","en ":"14","ent":"15"," en":"16"," se":"17","nte":"18","res":"19","con":"20","est":"21"," es":"22","s d":"23"," lo":"24"," pr":"25","los":"26"," y ":"27","do ":"28","ón ":"29","ión":"30"," un":"31","ció":"32","del":"33","o d":"34"," po":"35","a d":"36","aci":"37","sta":"38","te ":"39","ado":"40","pre":"41","to ":"42","par":"43","a e":"44","a l":"45","ra ":"46","al ":"47","e e":"48","se ":"49","pro":"50","ar ":"51","ia ":"52","o e":"53"," re":"54","ida":"55","dad":"56","tra":"57","por":"58","s p":"59"," a ":"60","a p":"61","ara":"62","cia":"63"," pa":"64","com":"65","no ":"66"," di":"67"," in":"68","ien":"69","n l":"70","ad ":"71","ant":"72","e s":"73","men":"74","a c":"75","on ":"76","un ":"77","las":"78","nci":"79"," tr":"80","cio":"81","ier":"82","nto":"83","tiv":"84","n d":"85","n e":"86","or ":"87","s c":"88","enc":"89","ern":"90","io ":"91","a s":"92","ici":"93","s e":"94"," ma":"95","dos":"96","e a":"97","e c":"98","emp":"99","ica":"100","ivo":"101","l p":"102","n c":"103","r e":"104","ta ":"105","ter":"106","e d":"107","esa":"108","ez ":"109","mpr":"110","o a":"111","s a":"112"," ca":"113"," su":"114","ion":"115"," cu":"116"," ju":"117","an ":"118","da ":"119","ene":"120","ero":"121","na ":"122","rec":"123","ro ":"124","tar":"125"," al":"126"," an":"127","bie":"128","e p":"129","er ":"130","l c":"131","n p":"132","omp":"133","ten":"134"," em":"135","ist":"136","nes":"137","nta":"138","o c":"139","so ":"140","tes":"141","era":"142","l d":"143","l m":"144","les":"145","ntr":"146","o s":"147","ore":"148","rá ":"149","s q":"150","s y":"151","sto":"152","a a":"153","a r":"154","ari":"155","des":"156","e q":"157","ivi":"158","lic":"159","lo ":"160","n a":"161","one":"162","ora":"163","per":"164","pue":"165","r l":"166","re ":"167","ren":"168","una":"169","ía ":"170","ada":"171","cas":"172","ere":"173","ide":"174","min":"175","n s":"176","ndo":"177","ran":"178","rno":"179"," ac":"180"," ex":"181"," go":"182"," no":"183","a t":"184","aba":"185","ble":"186","ece":"187","ect":"188","l a":"189","l g":"190","lid":"191","nsi":"192","ons":"193","rac":"194","rio":"195","str":"196","uer":"197","ust":"198"," ha":"199"," le":"200"," mi":"201"," mu":"202"," ob":"203"," pe":"204"," pu":"205"," so":"206","a i":"207","ale":"208","ca ":"209","cto":"210","e i":"211","e u":"212","eso":"213","fer":"214","fic":"215","gob":"216","jo ":"217","ma ":"218","mpl":"219","o p":"220","obi":"221","s m":"222","sa ":"223","sep":"224","ste":"225","sti":"226","tad":"227","tod":"228","y s":"229"," ci":"230","and":"231","ces":"232","có ":"233","dor":"234","e m":"235","eci":"236","eco":"237","esi":"238","int":"239","iza":"240","l e":"241","lar":"242","mie":"243","ner":"244","orc":"245","rci":"246","ria":"247","tic":"248","tor":"249"," as":"250"," si":"251","ce ":"252","den":"253","e r":"254","e t":"255","end":"256","eri":"257","esp":"258","ial":"259","ido":"260","ina":"261","inc":"262","mit":"263","o l":"264","ome":"265","pli":"266","ras":"267","s t":"268","sid":"269","sup":"270","tab":"271","uen":"272","ues":"273","ura":"274","vo ":"275","vor":"276"," sa":"277"," ti":"278","abl":"279","ali":"280","aso":"281","ast":"282","cor":"283","cti":"284","cue":"285","div":"286","duc":"287","ens":"288","eti":"289","imi":"290","ini":"291","lec":"292","o q":"293","oce":"294","ort":"295","ral":"296","rma":"297","roc":"298","rod":"299"},"swahili":{" wa":"0","wa ":"1","a k":"2","a m":"3"," ku":"4"," ya":"5","a w":"6","ya ":"7","ni ":"8"," ma":"9","ka ":"10","a u":"11","na ":"12","za ":"13","ia ":"14"," na":"15","ika":"16","ma ":"17","ali":"18","a n":"19"," am":"20","ili":"21","kwa":"22"," kw":"23","ini":"24"," ha":"25","ame":"26","ana":"27","i n":"28"," za":"29","a h":"30","ema":"31","i m":"32","i y":"33","kuw":"34","la ":"35","o w":"36","a y":"37","ata":"38","sem":"39"," la":"40","ati":"41","chi":"42","i w":"43","uwa":"44","aki":"45","li ":"46","eka":"47","ira":"48"," nc":"49","a s":"50","iki":"51","kat":"52","nch":"53"," ka":"54"," ki":"55","a b":"56","aji":"57","amb":"58","ra ":"59","ri ":"60","rik":"61","ada":"62","mat":"63","mba":"64","mes":"65","yo ":"66","zi ":"67","da ":"68","hi ":"69","i k":"70","ja ":"71","kut":"72","tek":"73","wan":"74"," bi":"75","a a":"76","aka":"77","ao ":"78","asi":"79","cha":"80","ese":"81","eza":"82","ke ":"83","moj":"84","oja":"85"," hi":"86","a z":"87","end":"88","ha ":"89","ji ":"90","mu ":"91","shi":"92","wat":"93"," bw":"94","ake":"95","ara":"96","bw ":"97","i h":"98","imb":"99","tik":"100","wak":"101","wal":"102"," hu":"103"," mi":"104"," mk":"105"," ni":"106"," ra":"107"," um":"108","a l":"109","ate":"110","esh":"111","ina":"112","ish":"113","kim":"114","o k":"115"," ir":"116","a i":"117","ala":"118","ani":"119","aq ":"120","azi":"121","hin":"122","i a":"123","idi":"124","ima":"125","ita":"126","rai":"127","raq":"128","sha":"129"," ms":"130"," se":"131","afr":"132","ama":"133","ano":"134","ea ":"135","ele":"136","fri":"137","go ":"138","i i":"139","ifa":"140","iwa":"141","iyo":"142","kus":"143","lia":"144","lio":"145","maj":"146","mku":"147","no ":"148","tan":"149","uli":"150","uta":"151","wen":"152"," al":"153","a j":"154","aad":"155","aid":"156","ari":"157","awa":"158","ba ":"159","fa ":"160","nde":"161","nge":"162","nya":"163","o y":"164","u w":"165","ua ":"166","umo":"167","waz":"168","ye ":"169"," ut":"170"," vi":"171","a d":"172","a t":"173","aif":"174","di ":"175","ere":"176","ing":"177","kin":"178","nda":"179","o n":"180","oa ":"181","tai":"182","toa":"183","usa":"184","uto":"185","was":"186","yak":"187","zo ":"188"," ji":"189"," mw":"190","a p":"191","aia":"192","amu":"193","ang":"194","bik":"195","bo ":"196","del":"197","e w":"198","ene":"199","eng":"200","ich":"201","iri":"202","iti":"203","ito":"204","ki ":"205","kir":"206","ko ":"207","kuu":"208","mar":"209","mbo":"210","mil":"211","ngi":"212","ngo":"213","o l":"214","ong":"215","si ":"216","ta ":"217","tak":"218","u y":"219","umu":"220","usi":"221","uu ":"222","wam":"223"," af":"224"," ba":"225"," li":"226"," si":"227"," zi":"228","a v":"229","ami":"230","atu":"231","awi":"232","eri":"233","fan":"234","fur":"235","ger":"236","i z":"237","isi":"238","izo":"239","lea":"240","mbi":"241","mwa":"242","nye":"243","o h":"244","o m":"245","oni":"246","rez":"247","saa":"248","ser":"249","sin":"250","tat":"251","tis":"252","tu ":"253","uin":"254","uki":"255","ur ":"256","wi ":"257","yar":"258"," da":"259"," en":"260"," mp":"261"," ny":"262"," ta":"263"," ul":"264"," we":"265","a c":"266","a f":"267","ais":"268","apo":"269","ayo":"270","bar":"271","dhi":"272","e a":"273","eke":"274","eny":"275","eon":"276","hai":"277","han":"278","hiy":"279","hur":"280","i s":"281","imw":"282","kal":"283","kwe":"284","lak":"285","lam":"286","mak":"287","msa":"288","ne ":"289","ngu":"290","ru ":"291","sal":"292","swa":"293","te ":"294","ti ":"295","uku":"296","uma":"297","una":"298","uru":"299"},"swedish":{"en ":"0"," de":"1","et ":"2","er ":"3","tt ":"4","om ":"5","för":"6","ar ":"7","de ":"8","att":"9"," fö":"10","ing":"11"," in":"12"," at":"13"," i ":"14","det":"15","ch ":"16","an ":"17","gen":"18"," an":"19","t s":"20","som":"21","te ":"22"," oc":"23","ter":"24"," ha":"25","lle":"26","och":"27"," sk":"28"," so":"29","ra ":"30","r a":"31"," me":"32","var":"33","nde":"34","är ":"35"," ko":"36","on ":"37","ans":"38","int":"39","n s":"40","na ":"41"," en":"42"," fr":"43"," på":"44"," st":"45"," va":"46","and":"47","nte":"48","på ":"49","ska":"50","ta ":"51"," vi":"52","der":"53","äll":"54","örs":"55"," om":"56","da ":"57","kri":"58","ka ":"59","nst":"60"," ho":"61","as ":"62","stä":"63","r d":"64","t f":"65","upp":"66"," be":"67","nge":"68","r s":"69","tal":"70","täl":"71","ör ":"72"," av":"73","ger":"74","ill":"75","ng ":"76","e s":"77","ekt":"78","ade":"79","era":"80","ers":"81","har":"82","ll ":"83","lld":"84","rin":"85","rna":"86","säk":"87","und":"88","inn":"89","lig":"90","ns ":"91"," ma":"92"," pr":"93"," up":"94","age":"95","av ":"96","iva":"97","kti":"98","lda":"99","orn":"100","son":"101","ts ":"102","tta":"103","äkr":"104"," sj":"105"," ti":"106","avt":"107","ber":"108","els":"109","eta":"110","kol":"111","men":"112","n d":"113","t k":"114","vta":"115","år ":"116","juk":"117","man":"118","n f":"119","nin":"120","r i":"121","rsä":"122","sju":"123","sso":"124"," är":"125","a s":"126","ach":"127","ag ":"128","bac":"129","den":"130","ett":"131","fte":"132","hor":"133","nba":"134","oll":"135","rnb":"136","ste":"137","til":"138"," ef":"139"," si":"140","a a":"141","e h":"142","ed ":"143","eft":"144","ga ":"145","ig ":"146","it ":"147","ler":"148","med":"149","n i":"150","nd ":"151","så ":"152","tiv":"153"," bl":"154"," et":"155"," fi":"156"," sä":"157","at ":"158","des":"159","e a":"160","gar":"161","get":"162","lan":"163","lss":"164","ost":"165","r b":"166","r e":"167","re ":"168","ret":"169","sta":"170","t i":"171"," ge":"172"," he":"173"," re":"174","a f":"175","all":"176","bos":"177","ets":"178","lek":"179","let":"180","ner":"181","nna":"182","nne":"183","r f":"184","rit":"185","s s":"186","sen":"187","sto":"188","tor":"189","vav":"190","ygg":"191"," ka":"192"," så":"193"," tr":"194"," ut":"195","ad ":"196","al ":"197","are":"198","e o":"199","gon":"200","kom":"201","n a":"202","n h":"203","nga":"204","r h":"205","ren":"206","t d":"207","tag":"208","tar":"209","tre":"210","ätt":"211"," få":"212"," hä":"213"," se":"214","a d":"215","a i":"216","a p":"217","ale":"218","ann":"219","ara":"220","byg":"221","gt ":"222","han":"223","igt":"224","kan":"225","la ":"226","n o":"227","nom":"228","nsk":"229","omm":"230","r k":"231","r p":"232","r v":"233","s f":"234","s k":"235","t a":"236","t p":"237","ver":"238"," bo":"239"," br":"240"," ku":"241"," nå":"242","a b":"243","a e":"244","del":"245","ens":"246","es ":"247","fin":"248","ige":"249","m s":"250","n p":"251","någ":"252","or ":"253","r o":"254","rbe":"255","rs ":"256","rt ":"257","s a":"258","s n":"259","skr":"260","t o":"261","ten":"262","tio":"263","ven":"264"," al":"265"," ja":"266"," p ":"267"," r ":"268"," sa":"269","a h":"270","bet":"271","cke":"272","dra":"273","e f":"274","e i":"275","eda":"276","eno":"277","erä":"278","ess":"279","ion":"280","jag":"281","m f":"282","ne ":"283","nns":"284","pro":"285","r t":"286","rar":"287","riv":"288","rät":"289","t e":"290","t t":"291","ust":"292","vad":"293","öre":"294"," ar":"295"," by":"296"," kr":"297"," mi":"298","arb":"299"},"tagalog":{"ng ":"0","ang":"1"," na":"2"," sa":"3","an ":"4","nan":"5","sa ":"6","na ":"7"," ma":"8"," ca":"9","ay ":"10","n g":"11"," an":"12","ong":"13"," ga":"14","at ":"15"," pa":"16","ala":"17"," si":"18","a n":"19","ga ":"20","g n":"21","g m":"22","ito":"23","g c":"24","man":"25","san":"26","g s":"27","ing":"28","to ":"29","ila":"30","ina":"31"," di":"32"," ta":"33","aga":"34","iya":"35","aca":"36","g t":"37"," at":"38","aya":"39","ama":"40","lan":"41","a a":"42","qui":"43","a c":"44","a s":"45","nag":"46"," ba":"47","g i":"48","tan":"49","'t ":"50"," cu":"51","aua":"52","g p":"53"," ni":"54","os ":"55","'y ":"56","a m":"57"," n ":"58","la ":"59"," la":"60","o n":"61","yan":"62"," ay":"63","usa":"64","cay":"65","on ":"66","ya ":"67"," it":"68","al ":"69","apa":"70","ata":"71","t n":"72","uan":"73","aha":"74","asa":"75","pag":"76"," gu":"77","g l":"78","di ":"79","mag":"80","aba":"81","g a":"82","ara":"83","a p":"84","in ":"85","ana":"86","it ":"87","si ":"88","cus":"89","g b":"90","uin":"91","a t":"92","as ":"93","n n":"94","hin":"95"," hi":"96","a't":"97","ali":"98"," bu":"99","gan":"100","uma":"101","a d":"102","agc":"103","aqu":"104","g d":"105"," tu":"106","aon":"107","ari":"108","cas":"109","i n":"110","niy":"111","pin":"112","a i":"113","gca":"114","siy":"115","a'y":"116","yao":"117","ag ":"118","ca ":"119","han":"120","ili":"121","pan":"122","sin":"123","ual":"124","n s":"125","nam":"126"," lu":"127","can":"128","dit":"129","gui":"130","y n":"131","gal":"132","hat":"133","nal":"134"," is":"135","bag":"136","fra":"137"," fr":"138"," su":"139","a l":"140"," co":"141","ani":"142"," bi":"143"," da":"144","alo":"145","isa":"146","ita":"147","may":"148","o s":"149","sil":"150","una":"151"," in":"152"," pi":"153","l n":"154","nil":"155","o a":"156","pat":"157","sac":"158","t s":"159"," ua":"160","agu":"161","ail":"162","bin":"163","dal":"164","g h":"165","ndi":"166","oon":"167","ua ":"168"," ha":"169","ind":"170","ran":"171","s n":"172","tin":"173","ulo":"174","eng":"175","g f":"176","ini":"177","lah":"178","lo ":"179","rai":"180","rin":"181","ton":"182","g u":"183","inu":"184","lon":"185","o'y":"186","t a":"187"," ar":"188","a b":"189","ad ":"190","bay":"191","cal":"192","gya":"193","ile":"194","mat":"195","n a":"196","pau":"197","ra ":"198","tay":"199","y m":"200","ant":"201","ban":"202","i m":"203","nas":"204","nay":"205","no ":"206","sti":"207"," ti":"208","ags":"209","g g":"210","ta ":"211","uit":"212","uno":"213"," ib":"214"," ya":"215","a u":"216","abi":"217","ati":"218","cap":"219","ig ":"220","is ":"221","la'":"222"," do":"223"," pu":"224","api":"225","ayo":"226","gos":"227","gul":"228","lal":"229","tag":"230","til":"231","tun":"232","y c":"233","y s":"234","yon":"235","ano":"236","bur":"237","iba":"238","isi":"239","lam":"240","nac":"241","nat":"242","ni ":"243","nto":"244","od ":"245","pa ":"246","rgo":"247","urg":"248"," m ":"249","adr":"250","ast":"251","cag":"252","gay":"253","gsi":"254","i p":"255","ino":"256","len":"257","lin":"258","m g":"259","mar":"260","nah":"261","to'":"262"," de":"263","a h":"264","cat":"265","cau":"266","con":"267","iqu":"268","lac":"269","mab":"270","min":"271","og ":"272","par":"273","sal":"274"," za":"275","ao ":"276","doo":"277","ipi":"278","nod":"279","nte":"280","uha":"281","ula":"282"," re":"283","ill":"284","lit":"285","mac":"286","nit":"287","o't":"288","or ":"289","ora":"290","sum":"291","y p":"292"," al":"293"," mi":"294"," um":"295","aco":"296","ada":"297","agd":"298","cab":"299"},"turkish":{"lar":"0","en ":"1","ler":"2","an ":"3","in ":"4"," bi":"5"," ya":"6","eri":"7","de ":"8"," ka":"9","ir ":"10","arı":"11"," ba":"12"," de":"13"," ha":"14","ın ":"15","ara":"16","bir":"17"," ve":"18"," sa":"19","ile":"20","le ":"21","nde":"22","da ":"23"," bu":"24","ana":"25","ini":"26","ını":"27","er ":"28","ve ":"29"," yı":"30","lma":"31","yıl":"32"," ol":"33","ar ":"34","n b":"35","nda":"36","aya":"37","li ":"38","ası":"39"," ge":"40","ind":"41","n k":"42","esi":"43","lan":"44","nla":"45","ak ":"46","anı":"47","eni":"48","ni ":"49","nı ":"50","rın":"51","san":"52"," ko":"53"," ye":"54","maz":"55","baş":"56","ili":"57","rin":"58","alı":"59","az ":"60","hal":"61","ınd":"62"," da":"63"," gü":"64","ele":"65","ılm":"66","ığı":"67","eki":"68","gün":"69","i b":"70","içi":"71","den":"72","kar":"73","si ":"74"," il":"75","e y":"76","na ":"77","yor":"78","ek ":"79","n s":"80"," iç":"81","bu ":"82","e b":"83","im ":"84","ki ":"85","len":"86","ri ":"87","sın":"88"," so":"89","ün ":"90"," ta":"91","nin":"92","iği":"93","tan":"94","yan":"95"," si":"96","nat":"97","nın":"98","kan":"99","rı ":"100","çin":"101","ğı ":"102","eli":"103","n a":"104","ır ":"105"," an":"106","ine":"107","n y":"108","ola":"109"," ar":"110","al ":"111","e s":"112","lik":"113","n d":"114","sin":"115"," al":"116"," dü":"117","anl":"118","ne ":"119","ya ":"120","ım ":"121","ına":"122"," be":"123","ada":"124","ala":"125","ama":"126","ilm":"127","or ":"128","sı ":"129","yen":"130"," me":"131","atı":"132","di ":"133","eti":"134","ken":"135","la ":"136","lı ":"137","oru":"138"," gö":"139"," in":"140","and":"141","e d":"142","men":"143","un ":"144","öne":"145","a d":"146","at ":"147","e a":"148","e g":"149","yar":"150"," ku":"151","ayı":"152","dan":"153","edi":"154","iri":"155","ünü":"156","ği ":"157","ılı":"158","eme":"159","eği":"160","i k":"161","i y":"162","ıla":"163"," ça":"164","a y":"165","alk":"166","dı ":"167","ede":"168","el ":"169","ndı":"170","ra ":"171","üne":"172"," sü":"173","dır":"174","e k":"175","ere":"176","ik ":"177","imi":"178","işi":"179","mas":"180","n h":"181","sür":"182","yle":"183"," ad":"184"," fi":"185"," gi":"186"," se":"187","a k":"188","arl":"189","aşı":"190","iyo":"191","kla":"192","lığ":"193","nem":"194","ney":"195","rme":"196","ste":"197","tı ":"198","unl":"199","ver":"200"," sı":"201"," te":"202"," to":"203","a s":"204","aşk":"205","ekl":"206","end":"207","kal":"208","liğ":"209","min":"210","tır":"211","ulu":"212","unu":"213","yap":"214","ye ":"215","ı i":"216","şka":"217","ştı":"218"," bü":"219"," ke":"220"," ki":"221","ard":"222","art":"223","aşa":"224","n i":"225","ndi":"226","ti ":"227","top":"228","ı b":"229"," va":"230"," ön":"231","aki":"232","cak":"233","ey ":"234","fil":"235","isi":"236","kle":"237","kur":"238","man":"239","nce":"240","nle":"241","nun":"242","rak":"243","ık ":"244"," en":"245"," yo":"246","a g":"247","lis":"248","mak":"249","n g":"250","tir":"251","yas":"252"," iş":"253"," yö":"254","ale":"255","bil":"256","bul":"257","et ":"258","i d":"259","iye":"260","kil":"261","ma ":"262","n e":"263","n t":"264","nu ":"265","olu":"266","rla":"267","te ":"268","yön":"269","çık":"270"," ay":"271"," mü":"272"," ço":"273"," çı":"274","a a":"275","a b":"276","ata":"277","der":"278","gel":"279","i g":"280","i i":"281","ill":"282","ist":"283","ldı":"284","lu ":"285","mek":"286","mle":"287","n ç":"288","onu":"289","opl":"290","ran":"291","rat":"292","rdı":"293","rke":"294","siy":"295","son":"296","ta ":"297","tçı":"298","tın":"299"},"ukrainian":{" на":"0"," за":"1","ння":"2","ня ":"3","на ":"4"," пр":"5","ого":"6","го ":"7","ськ":"8"," по":"9"," у ":"10","від":"11","ере":"12"," мі":"13"," не":"14","их ":"15","ть ":"16","пер":"17"," ві":"18","ів ":"19"," пе":"20"," що":"21","льн":"22","ми ":"23","ні ":"24","не ":"25","ти ":"26","ати":"27","енн":"28","міс":"29","пра":"30","ува":"31","ник":"32","про":"33","рав":"34","івн":"35"," та":"36","буд":"37","влі":"38","рів":"39"," ко":"40"," рі":"41","аль":"42","но ":"43","ому":"44","що ":"45"," ви":"46","му ":"47","рев":"48","ся ":"49","інн":"50"," до":"51"," уп":"52","авл":"53","анн":"54","ком":"55","ли ":"56","лін":"57","ног":"58","упр":"59"," бу":"60"," з ":"61"," ро":"62","за ":"63","и н":"64","нов":"65","оро":"66","ост":"67","ста":"68","ті ":"69","ють":"70"," мо":"71"," ні":"72"," як":"73","бор":"74","ва ":"75","ван":"76","ень":"77","и п":"78","нь ":"79","ові":"80","рон":"81","сті":"82","та ":"83","у в":"84","ько":"85","іст":"86"," в ":"87"," ре":"88","до ":"89","е п":"90","заб":"91","ий ":"92","нсь":"93","о в":"94","о п":"95","при":"96","і п":"97"," ку":"98"," пі":"99"," сп":"100","а п":"101","або":"102","анс":"103","аці":"104","ват":"105","вни":"106","и в":"107","ими":"108","ка ":"109","нен":"110","ніч":"111","она":"112","ої ":"113","пов":"114","ьки":"115","ьно":"116","ізн":"117","ічн":"118"," ав":"119"," ма":"120"," ор":"121"," су":"122"," чи":"123"," ін":"124","а з":"125","ам ":"126","ає ":"127","вне":"128","вто":"129","дом":"130","ент":"131","жит":"132","зни":"133","им ":"134","итл":"135","ла ":"136","них":"137","ниц":"138","ова":"139","ови":"140","ом ":"141","пор":"142","тьс":"143","у р":"144","ься":"145","ідо":"146","іль":"147","ісь":"148"," ва":"149"," ді":"150"," жи":"151"," че":"152"," і ":"153","а в":"154","а н":"155","али":"156","вез":"157","вно":"158","еве":"159","езе":"160","зен":"161","ицт":"162","ки ":"163","ких":"164","кон":"165","ку ":"166","лас":"167","ля ":"168","мож":"169","нач":"170","ним":"171","ної":"172","о б":"173","ову":"174","оди":"175","ою ":"176","ро ":"177","рок":"178","сно":"179","спо":"180","так":"181","тва":"182","ту ":"183","у п":"184","цтв":"185","ьни":"186","я з":"187","і м":"188","ії ":"189"," вс":"190"," гр":"191"," де":"192"," но":"193"," па":"194"," се":"195"," ук":"196"," їх":"197","а о":"198","авт":"199","аст":"200","ают":"201","вар":"202","ден":"203","ди ":"204","ду ":"205","зна":"206","и з":"207","ико":"208","ися":"209","ити":"210","ког":"211","мен":"212","ном":"213","ну ":"214","о н":"215","о с":"216","обу":"217","ово":"218","пла":"219","ран":"220","рив":"221","роб":"222","ска":"223","тан":"224","тим":"225","тис":"226","то ":"227","тра":"228","удо":"229","чин":"230","чни":"231","і в":"232","ію ":"233"," а ":"234"," во":"235"," да":"236"," кв":"237"," ме":"238"," об":"239"," ск":"240"," ти":"241"," фі":"242"," є ":"243","а р":"244","а с":"245","а у":"246","ак ":"247","ані":"248","арт":"249","асн":"250","в у":"251","вик":"252","віз":"253","дов":"254","дпо":"255","дів":"256","еві":"257","енс":"258","же ":"259","и м":"260","и с":"261","ика":"262","ичн":"263","кі ":"264","ків":"265","між":"266","нан":"267","нос":"268","о у":"269","обл":"270","одн":"271","ок ":"272","оло":"273","отр":"274","рен":"275","рим":"276","роз":"277","сь ":"278","сі ":"279","тла":"280","тів":"281","у з":"282","уго":"283","уді":"284","чи ":"285","ше ":"286","я н":"287","я у":"288","ідп":"289","ій ":"290","іна":"291","ія ":"292"," ка":"293"," ни":"294"," ос":"295"," си":"296"," то":"297"," тр":"298"," уг":"299"},"urdu":{"یں ":"0"," کی":"1","کے ":"2"," کے":"3","نے ":"4"," کہ":"5","ے ک":"6","کی ":"7","میں":"8"," می":"9","ہے ":"10","وں ":"11","کہ ":"12"," ہے":"13","ان ":"14","ہیں":"15","ور ":"16"," کو":"17","یا ":"18"," ان":"19"," نے":"20","سے ":"21"," سے":"22"," کر":"23","ستا":"24"," او":"25","اور":"26","تان":"27","ر ک":"28","ی ک":"29"," اس":"30","ے ا":"31"," پا":"32"," ہو":"33"," پر":"34","رف ":"35"," کا":"36","ا ک":"37","ی ا":"38"," ہی":"39","در ":"40","کو ":"41"," ای":"42","ں ک":"43"," مش":"44"," مل":"45","ات ":"46","صدر":"47","اکس":"48","شرف":"49","مشر":"50","پاک":"51","کست":"52","ی م":"53"," دی":"54"," صد":"55"," یہ":"56","ا ہ":"57","ن ک":"58","وال":"59","یہ ":"60","ے و":"61"," بھ":"62"," دو":"63","اس ":"64","ر ا":"65","نہی":"66","کا ":"67","ے س":"68","ئی ":"69","ہ ا":"70","یت ":"71","ے ہ":"72","ت ک":"73"," سا":"74","لے ":"75","ہا ":"76","ے ب":"77"," وا":"78","ار ":"79","نی ":"80","کہا":"81","ی ہ":"82","ے م":"83"," سی":"84"," لی":"85","انہ":"86","انی":"87","ر م":"88","ر پ":"89","ریت":"90","ن م":"91","ھا ":"92","یر ":"93"," جا":"94"," جن":"95","ئے ":"96","پر ":"97","ں ن":"98","ہ ک":"99","ی و":"100","ے د":"101"," تو":"102"," تھ":"103"," گی":"104","ایک":"105","ل ک":"106","نا ":"107","کر ":"108","ں م":"109","یک ":"110"," با":"111","ا ت":"112","دی ":"113","ن س":"114","کیا":"115","یوں":"116","ے ج":"117","ال ":"118","تو ":"119","ں ا":"120","ے پ":"121"," چا":"122","ام ":"123","بھی":"124","تی ":"125","تے ":"126","دوس":"127","س ک":"128","ملک":"129","ن ا":"130","ہور":"131","یے ":"132"," مو":"133"," وک":"134","ائی":"135","ارت":"136","الے":"137","بھا":"138","ردی":"139","ری ":"140","وہ ":"141","ویز":"142","ں د":"143","ھی ":"144","ی س":"145"," رہ":"146"," من":"147"," نہ":"148"," ور":"149"," وہ":"150"," ہن":"151","ا ا":"152","است":"153","ت ا":"154","ت پ":"155","د ک":"156","ز م":"157","ند ":"158","ورد":"159","وکل":"160","گی ":"161","گیا":"162","ہ پ":"163","یز ":"164","ے ت":"165"," اع":"166"," اپ":"167"," جس":"168"," جم":"169"," جو":"170"," سر":"171","اپن":"172","اکث":"173","تھا":"174","ثری":"175","دیا":"176","ر د":"177","رت ":"178","روی":"179","سی ":"180","ملا":"181","ندو":"182","وست":"183","پرو":"184","چاہ":"185","کثر":"186","کلا":"187","ہ ہ":"188","ہند":"189","ہو ":"190","ے ل":"191"," اک":"192"," دا":"193"," سن":"194"," وز":"195"," پی":"196","ا چ":"197","اء ":"198","اتھ":"199","اقا":"200","اہ ":"201","تھ ":"202","دو ":"203","ر ب":"204","روا":"205","رے ":"206","سات":"207","ف ک":"208","قات":"209","لا ":"210","لاء":"211","م م":"212","م ک":"213","من ":"214","نوں":"215","و ا":"216","کرن":"217","ں ہ":"218","ھار":"219","ہوئ":"220","ہی ":"221","یش ":"222"," ام":"223"," لا":"224"," مس":"225"," پو":"226"," پہ":"227","انے":"228","ت م":"229","ت ہ":"230","ج ک":"231","دون":"232","زیر":"233","س س":"234","ش ک":"235","ف ن":"236","ل ہ":"237","لاق":"238","لی ":"239","وری":"240","وزی":"241","ونو":"242","کھن":"243","گا ":"244","ں س":"245","ں گ":"246","ھنے":"247","ھے ":"248","ہ ب":"249","ہ ج":"250","ہر ":"251","ی آ":"252","ی پ":"253"," حا":"254"," وف":"255"," گا":"256","ا ج":"257","ا گ":"258","اد ":"259","ادی":"260","اعظ":"261","اہت":"262","جس ":"263","جمہ":"264","جو ":"265","ر س":"266","ر ہ":"267","رنے":"268","س م":"269","سا ":"270","سند":"271","سنگ":"272","ظم ":"273","عظم":"274","ل م":"275","لیے":"276","مل ":"277","موہ":"278","مہو":"279","نگھ":"280","و ص":"281","ورٹ":"282","وہن":"283","کن ":"284","گھ ":"285","گے ":"286","ں ج":"287","ں و":"288","ں ی":"289","ہ د":"290","ہن ":"291","ہوں":"292","ے ح":"293","ے گ":"294","ے ی":"295"," اگ":"296"," بع":"297"," رو":"298"," شا":"299"},"uzbek":{"ан ":"0","ган":"1","лар":"2","га ":"3","нг ":"4","инг":"5","нин":"6","да ":"7","ни ":"8","ида":"9","ари":"10","ига":"11","ини":"12","ар ":"13","ди ":"14"," би":"15","ани":"16"," бо":"17","дан":"18","лга":"19"," ҳа":"20"," ва":"21"," са":"22","ги ":"23","ила":"24","н б":"25","и б":"26"," кў":"27"," та":"28","ир ":"29"," ма":"30","ага":"31","ала":"32","бир":"33","ри ":"34","тга":"35","лан":"36","лик":"37","а к":"38","аги":"39","ати":"40","та ":"41","ади":"42","даг":"43","рга":"44"," йи":"45"," ми":"46"," па":"47"," бў":"48"," қа":"49"," қи":"50","а б":"51","илл":"52","ли ":"53","аси":"54","и т":"55","ик ":"56","или":"57","лла":"58","ард":"59","вчи":"60","ва ":"61","иб ":"62","ири":"63","лиг":"64","нга":"65","ран":"66"," ке":"67"," ўз":"68","а с":"69","ахт":"70","бўл":"71","иги":"72","кўр":"73","рда":"74","рни":"75","са ":"76"," бе":"77"," бу":"78"," да":"79"," жа":"80","а т":"81","ази":"82","ери":"83","и а":"84","илг":"85","йил":"86","ман":"87","пах":"88","рид":"89","ти ":"90","увч":"91","хта":"92"," не":"93"," со":"94"," уч":"95","айт":"96","лли":"97","тла":"98"," ай":"99"," фр":"100"," эт":"101"," ҳо":"102","а қ":"103","али":"104","аро":"105","бер":"106","бил":"107","бор":"108","ими":"109","ист":"110","он ":"111","рин":"112","тер":"113","тил":"114","ун ":"115","фра":"116","қил":"117"," ба":"118"," ол":"119","анс":"120","ефт":"121","зир":"122","кат":"123","мил":"124","неф":"125","саг":"126","чи ":"127","ўра":"128"," на":"129"," те":"130"," эн":"131","а э":"132","ам ":"133","арн":"134","ат ":"135","иш ":"136","ма ":"137","нла":"138","рли":"139","чил":"140","шга":"141"," иш":"142"," му":"143"," ўқ":"144","ара":"145","ваз":"146","и у":"147","иқ ":"148","моқ":"149","рим":"150","учу":"151","чун":"152","ши ":"153","энг":"154","қув":"155","ҳам":"156"," сў":"157"," ши":"158","бар":"159","бек":"160","дам":"161","и ҳ":"162","иши":"163","лад":"164","оли":"165","олл":"166","ори":"167","оқд":"168","р б":"169","ра ":"170","рла":"171","уни":"172","фт ":"173","ўлг":"174","ўқу":"175"," де":"176"," ка":"177"," қў":"178","а ў":"179","аба":"180","амм":"181","атл":"182","б к":"183","бош":"184","збе":"185","и в":"186","им ":"187","ин ":"188","ишл":"189","лаб":"190","лей":"191","мин":"192","н д":"193","нда":"194","оқ ":"195","р м":"196","рил":"197","сид":"198","тал":"199","тан":"200","тид":"201","тон":"202","ўзб":"203"," ам":"204"," ки":"205","а ҳ":"206","анг":"207","анд":"208","арт":"209","аёт":"210","дир":"211","ент":"212","и д":"213","и м":"214","и о":"215","и э":"216","иро":"217","йти":"218","нсу":"219","оди":"220","ор ":"221","си ":"222","тиш":"223","тоб":"224","эти":"225","қар":"226","қда":"227"," бл":"228"," ге":"229"," до":"230"," ду":"231"," но":"232"," пр":"233"," ра":"234"," фо":"235"," қо":"236","а м":"237","а о":"238","айд":"239","ало":"240","ама":"241","бле":"242","г н":"243","дол":"244","ейр":"245","ек ":"246","ерг":"247","жар":"248","зид":"249","и к":"250","и ф":"251","ий ":"252","ило":"253","лди":"254","либ":"255","лин":"256","ми ":"257","мма":"258","н в":"259","н к":"260","н ў":"261","н ҳ":"262","ози":"263","ора":"264","оси":"265","рас":"266","риш":"267","рка":"268","роқ":"269","сто":"270","тин":"271","хат":"272","шир":"273"," ав":"274"," рў":"275"," ту":"276"," ўт":"277","а п":"278","авт":"279","ада":"280","аза":"281","анл":"282","б б":"283","бой":"284","бу ":"285","вто":"286","г э":"287","гин":"288","дар":"289","ден":"290","дун":"291","иде":"292","ион":"293","ирл":"294","ишг":"295","йха":"296","кел":"297","кўп":"298","лио":"299"},"vietnamese":{"ng ":"0"," th":"1"," ch":"2","g t":"3"," nh":"4","ông":"5"," kh":"6"," tr":"7","nh ":"8"," cô":"9","côn":"10"," ty":"11","ty ":"12","i t":"13","n t":"14"," ng":"15","ại ":"16"," ti":"17","ch ":"18","y l":"19","ền ":"20"," đư":"21","hi ":"22"," gở":"23","gởi":"24","iền":"25","tiề":"26","ởi ":"27"," gi":"28"," le":"29"," vi":"30","cho":"31","ho ":"32","khá":"33"," và":"34","hác":"35"," ph":"36","am ":"37","hàn":"38","ách":"39","ôi ":"40","i n":"41","ược":"42","ợc ":"43"," tô":"44","chú":"45","iệt":"46","tôi":"47","ên ":"48","úng":"49","ệt ":"50"," có":"51","c t":"52","có ":"53","hún":"54","việ":"55","đượ":"56"," na":"57","g c":"58","i c":"59","n c":"60","n n":"61","t n":"62","và ":"63","n l":"64","n đ":"65","àng":"66","ác ":"67","ất ":"68","h l":"69","nam":"70","ân ":"71","ăm ":"72"," hà":"73"," là":"74"," nă":"75"," qu":"76"," tạ":"77","g m":"78","năm":"79","tại":"80","ới ":"81"," lẹ":"82","ay ":"83","e g":"84","h h":"85","i v":"86","i đ":"87","le ":"88","lẹ ":"89","ều ":"90","ời ":"91","hân":"92","nhi":"93","t t":"94"," củ":"95"," mộ":"96"," về":"97"," đi":"98","an ":"99","của":"100","là ":"101","một":"102","về ":"103","ành":"104","ết ":"105","ột ":"106","ủa ":"107"," bi":"108"," cá":"109","a c":"110","anh":"111","các":"112","h c":"113","iều":"114","m t":"115","ện ":"116"," ho":"117","'s ":"118","ave":"119","e's":"120","el ":"121","g n":"122","le'":"123","n v":"124","o c":"125","rav":"126","s t":"127","thi":"128","tra":"129","vel":"130","ận ":"131","ến ":"132"," ba":"133"," cu":"134"," sa":"135"," đó":"136"," đế":"137","c c":"138","chu":"139","hiề":"140","huy":"141","khi":"142","nhâ":"143","như":"144","ong":"145","ron":"146","thu":"147","thư":"148","tro":"149","y c":"150","ày ":"151","đến":"152","ười":"153","ườn":"154","ề v":"155","ờng":"156"," vớ":"157","cuộ":"158","g đ":"159","iết":"160","iện":"161","ngà":"162","o t":"163","u c":"164","uộc":"165","với":"166","à c":"167","ài ":"168","ơng":"169","ươn":"170","ải ":"171","ộc ":"172","ức ":"173"," an":"174"," lậ":"175"," ra":"176"," sẽ":"177"," số":"178"," tổ":"179","a k":"180","biế":"181","c n":"182","c đ":"183","chứ":"184","g v":"185","gia":"186","gày":"187","hán":"188","hôn":"189","hư ":"190","hức":"191","i g":"192","i h":"193","i k":"194","i p":"195","iên":"196","khô":"197","lập":"198","n k":"199","ra ":"200","rên":"201","sẽ ":"202","t c":"203","thà":"204","trê":"205","tổ ":"206","u n":"207","y t":"208","ình":"209","ấy ":"210","ập ":"211","ổ c":"212"," má":"213"," để":"214","ai ":"215","c s":"216","gườ":"217","h v":"218","hoa":"219","hoạ":"220","inh":"221","m n":"222","máy":"223","n g":"224","ngư":"225","nhậ":"226","o n":"227","oa ":"228","oàn":"229","p c":"230","số ":"231","t đ":"232","y v":"233","ào ":"234","áy ":"235","ăn ":"236","đó ":"237","để ":"238","ước":"239","ần ":"240","ển ":"241","ớc ":"242"," bá":"243"," cơ":"244"," cả":"245"," cầ":"246"," họ":"247"," kỳ":"248"," li":"249"," mạ":"250"," sở":"251"," tặ":"252"," vé":"253"," vụ":"254"," đạ":"255","a đ":"256","bay":"257","cơ ":"258","g s":"259","han":"260","hươ":"261","i s":"262","kỳ ":"263","m c":"264","n m":"265","n p":"266","o b":"267","oại":"268","qua":"269","sở ":"270","tha":"271","thá":"272","tặn":"273","vào":"274","vé ":"275","vụ ":"276","y b":"277","àn ":"278","áng":"279","ơ s":"280","ầu ":"281","ật ":"282","ặng":"283","ọc ":"284","ở t":"285","ững":"286"," du":"287"," lu":"288"," ta":"289"," to":"290"," từ":"291"," ở ":"292","a v":"293","ao ":"294","c v":"295","cả ":"296","du ":"297","g l":"298","giả":"299"},"welsh":{"yn ":"0","dd ":"1"," yn":"2"," y ":"3","ydd":"4","eth":"5","th ":"6"," i ":"7","aet":"8","d y":"9","ch ":"10","od ":"11","ol ":"12","edd":"13"," ga":"14"," gw":"15","'r ":"16","au ":"17","ddi":"18","ad ":"19"," cy":"20"," gy":"21"," ei":"22"," o ":"23","iad":"24","yr ":"25","an ":"26","bod":"27","wed":"28"," bo":"29"," dd":"30","el ":"31","n y":"32"," am":"33","di ":"34","edi":"35","on ":"36"," we":"37"," ym":"38"," ar":"39"," rh":"40","odd":"41"," ca":"42"," ma":"43","ael":"44","oed":"45","dae":"46","n a":"47","dda":"48","er ":"49","h y":"50","all":"51","ei ":"52"," ll":"53","am ":"54","eu ":"55","fod":"56","fyd":"57","l y":"58","n g":"59","wyn":"60","d a":"61","i g":"62","mae":"63","neu":"64","os ":"65"," ne":"66","d i":"67","dod":"68","dol":"69","n c":"70","r h":"71","wyd":"72","wyr":"73","ai ":"74","ar ":"75","in ":"76","rth":"77"," fy":"78"," he":"79"," me":"80"," yr":"81","'n ":"82","dia":"83","est":"84","h c":"85","hai":"86","i d":"87","id ":"88","r y":"89","y b":"90"," dy":"91"," ha":"92","ada":"93","i b":"94","n i":"95","ote":"96","rot":"97","tes":"98","y g":"99","yd ":"100"," ad":"101"," mr":"102"," un":"103","cyn":"104","dau":"105","ddy":"106","edo":"107","i c":"108","i w":"109","ith":"110","lae":"111","lla":"112","nd ":"113","oda":"114","ryd":"115","tho":"116"," a ":"117"," dr":"118","aid":"119","ain":"120","ddo":"121","dyd":"122","fyn":"123","gyn":"124","hol":"125","io ":"126","o a":"127","wch":"128","wyb":"129","ybo":"130","ych":"131"," br":"132"," by":"133"," di":"134"," fe":"135"," na":"136"," o'":"137"," pe":"138","art":"139","byd":"140","dro":"141","gal":"142","l e":"143","lai":"144","mr ":"145","n n":"146","r a":"147","rhy":"148","wn ":"149","ynn":"150"," on":"151"," r ":"152","cae":"153","d g":"154","d o":"155","d w":"156","gan":"157","gwy":"158","n d":"159","n f":"160","n o":"161","ned":"162","ni ":"163","o'r":"164","r d":"165","ud ":"166","wei":"167","wrt":"168"," an":"169"," cw":"170"," da":"171"," ni":"172"," pa":"173"," pr":"174"," wy":"175","d e":"176","dai":"177","dim":"178","eud":"179","gwa":"180","idd":"181","im ":"182","iri":"183","lwy":"184","n b":"185","nol":"186","r o":"187","rwy":"188"," ch":"189"," er":"190"," fo":"191"," ge":"192"," hy":"193"," i'":"194"," ro":"195"," sa":"196"," tr":"197","bob":"198","cwy":"199","cyf":"200","dio":"201","dyn":"202","eit":"203","hel":"204","hyn":"205","ich":"206","ll ":"207","mdd":"208","n r":"209","ond":"210","pro":"211","r c":"212","r g":"213","red":"214","rha":"215","u a":"216","u c":"217","u y":"218","y c":"219","ymd":"220","ymr":"221","yw ":"222"," ac":"223"," be":"224"," bl":"225"," co":"226"," os":"227","adw":"228","ae ":"229","af ":"230","d p":"231","efn":"232","eic":"233","en ":"234","eol":"235","es ":"236","fer":"237","gel":"238","h g":"239","hod":"240","ied":"241","ir ":"242","laf":"243","n h":"244","na ":"245","nyd":"246","odo":"247","ofy":"248","rdd":"249","rie":"250","ros":"251","stw":"252","twy":"253","yda":"254","yng":"255"," at":"256"," de":"257"," go":"258"," id":"259"," oe":"260"," â ":"261","'ch":"262","ac ":"263","ach":"264","ae'":"265","al ":"266","bl ":"267","d c":"268","d l":"269","dan":"270","dde":"271","ddw":"272","dir":"273","dla":"274","ed ":"275","ela":"276","ell":"277","ene":"278","ewn":"279","gyd":"280","hau":"281","hyw":"282","i a":"283","i f":"284","iol":"285","ion":"286","l a":"287","l i":"288","lia":"289","med":"290","mon":"291","n s":"292","no ":"293","obl":"294","ola":"295","ref":"296","rn ":"297","thi":"298","un ":"299"}},"trigram-unicodemap":{"Basic Latin":{"albanian":661,"azeri":653,"bengali":1,"cebuano":750,"croatian":733,"czech":652,"danish":734,"dutch":741,"english":723,"estonian":739,"finnish":743,"french":733,"german":750,"hausa":752,"hawaiian":751,"hungarian":693,"icelandic":662,"indonesian":776,"italian":741,"latin":764,"latvian":693,"lithuanian":738,"mongolian":19,"norwegian":742,"pidgin":702,"polish":701,"portuguese":726,"romanian":714,"slovak":677,"slovene":740,"somali":755,"spanish":749,"swahili":770,"swedish":717,"tagalog":767,"turkish":673,"vietnamese":503,"welsh":728},"Latin-1 Supplement":{"albanian":68,"azeri":10,"czech":51,"danish":13,"estonian":19,"finnish":39,"french":21,"german":8,"hungarian":72,"icelandic":80,"italian":3,"norwegian":5,"polish":6,"portuguese":18,"romanian":9,"slovak":37,"spanish":6,"swedish":26,"turkish":25,"vietnamese":56,"welsh":1},"[Malformatted]":{"albanian":68,"arabic":724,"azeri":109,"bengali":1472,"bulgarian":750,"croatian":10,"czech":78,"danish":13,"estonian":19,"farsi":706,"finnish":39,"french":21,"german":8,"hausa":8,"hindi":1386,"hungarian":74,"icelandic":80,"italian":3,"kazakh":767,"kyrgyz":767,"latvian":56,"lithuanian":30,"macedonian":755,"mongolian":743,"nepali":1514,"norwegian":5,"pashto":677,"polish":45,"portuguese":18,"romanian":31,"russian":759,"serbian":757,"slovak":45,"slovene":10,"spanish":6,"swedish":26,"turkish":87,"ukrainian":748,"urdu":682,"uzbek":773,"vietnamese":289,"welsh":1},"Arabic":{"arabic":724,"farsi":706,"pashto":677,"urdu":682},"Latin Extended-B":{"azeri":73,"hausa":8,"vietnamese":19},"Latin Extended-A":{"azeri":25,"croatian":10,"czech":27,"hungarian":2,"latvian":56,"lithuanian":30,"polish":39,"romanian":22,"slovak":8,"slovene":10,"turkish":62,"vietnamese":20},"Combining Diacritical Marks":{"azeri":1},"Bengali":{"bengali":714},"Gujarati":{"bengali":16},"Gurmukhi":{"bengali":6},"Cyrillic":{"bulgarian":750,"kazakh":767,"kyrgyz":767,"macedonian":755,"mongolian":743,"russian":759,"serbian":757,"ukrainian":748,"uzbek":773},"Devanagari":{"hindi":693,"nepali":757},"Latin Extended Additional":{"vietnamese":97}}};

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

/***/ 39:
/***/ (function(module) {

var Languages = module.exports = {
  getCode2:function (lang) {
    return Languages.nameToCode2[String(lang).toLowerCase()] || null;
  },

  getCode3: function(lang) {
    return Languages.nameToCode3[String(lang).toLowerCase()] || null;
  },

  getName2: function(code) {
    return Languages.code2ToName[String(code).toLowerCase()] || null;
  },

  getName3: function(code) {
    return Languages.code3ToName[String(code).toLowerCase()] || null;
  },

  nameToCode2:{
    'albanian':'sq',
    'arabic':'ar',
    'azeri':'az',
    'bengali':'bn',
    'bulgarian':'bg',
    'cebuano':null,
    'croatian':'hr',
    'czech':'cs',
    'danish':'da',
    'dutch':'nl',
    'english':'en',
    'estonian':'et',
    'farsi':'fa',
    'finnish':'fi',
    'french':'fr',
    'german':'de',
    'hausa':'ha',
    'hawaiian':null,
    'hindi':'hi',
    'hungarian':'hu',
    'icelandic':'is',
    'indonesian':'id',
    'italian':'it',
    'kazakh':'kk',
    'kyrgyz':'ky',
    'latin':'la',
    'latvian':'lv',
    'lithuanian':'lt',
    'macedonian':'mk',
    'mongolian':'mn',
    'nepali':'ne',
    'norwegian':'no',
    'pashto':'ps',
    'pidgin':null,
    'polish':'pl',
    'portuguese':'pt',
    'romanian':'ro',
    'russian':'ru',
    'serbian':'sr',
    'slovak':'sk',
    'slovene':'sl',
    'somali':'so',
    'spanish':'es',
    'swahili':'sw',
    'swedish':'sv',
    'tagalog':'tl',
    'turkish':'tr',
    'ukrainian':'uk',
    'urdu':'ur',
    'uzbek':'uz',
    'vietnamese':'vi',
    'welsh':'cy'
  },

  nameToCode3:{
    'albanian':'sqi',
    'arabic':'ara',
    'azeri':'aze',
    'bengali':'ben',
    'bulgarian':'bul',
    'cebuano':'ceb',
    'croatian':'hrv',
    'czech':'ces',
    'danish':'dan',
    'dutch':'nld',
    'english':'eng',
    'estonian':'est',
    'farsi':'fas',
    'finnish':'fin',
    'french':'fra',
    'german':'deu',
    'hausa':'hau',
    'hawaiian':'haw',
    'hindi':'hin',
    'hungarian':'hun',
    'icelandic':'isl',
    'indonesian':'ind',
    'italian':'ita',
    'kazakh':'kaz',
    'kyrgyz':'kir',
    'latin':'lat',
    'latvian':'lav',
    'lithuanian':'lit',
    'macedonian':'mkd',
    'mongolian':'mon',
    'nepali':'nep',
    'norwegian':'nor',
    'pashto':'pus',
    'pidgin':'crp',
    'polish':'pol',
    'portuguese':'por',
    'romanian':'ron',
    'russian':'rus',
    'serbian':'srp',
    'slovak':'slk',
    'slovene':'slv',
    'somali':'som',
    'spanish':'spa',
    'swahili':'swa',
    'swedish':'swe',
    'tagalog':'tgl',
    'turkish':'tur',
    'ukrainian':'ukr',
    'urdu':'urd',
    'uzbek':'uzb',
    'vietnamese':'vie',
    'welsh':'cym'
  },
  code2ToName:{
    'ar':'arabic',
    'az':'azeri',
    'bg':'bulgarian',
    'bn':'bengali',
    'cs':'czech',
    'cy':'welsh',
    'da':'danish',
    'de':'german',
    'en':'english',
    'es':'spanish',
    'et':'estonian',
    'fa':'farsi',
    'fi':'finnish',
    'fr':'french',
    'ha':'hausa',
    'hi':'hindi',
    'hr':'croatian',
    'hu':'hungarian',
    'id':'indonesian',
    'is':'icelandic',
    'it':'italian',
    'kk':'kazakh',
    'ky':'kyrgyz',
    'la':'latin',
    'lt':'lithuanian',
    'lv':'latvian',
    'mk':'macedonian',
    'mn':'mongolian',
    'ne':'nepali',
    'nl':'dutch',
    'no':'norwegian',
    'pl':'polish',
    'ps':'pashto',
    'pt':'portuguese',
    'ro':'romanian',
    'ru':'russian',
    'sk':'slovak',
    'sl':'slovene',
    'so':'somali',
    'sq':'albanian',
    'sr':'serbian',
    'sv':'swedish',
    'sw':'swahili',
    'tl':'tagalog',
    'tr':'turkish',
    'uk':'ukrainian',
    'ur':'urdu',
    'uz':'uzbek',
    'vi':'vietnamese'
  },

  code3ToName:{
    'ara':'arabic',
    'aze':'azeri',
    'ben':'bengali',
    'bul':'bulgarian',
    'ceb':'cebuano',
    'ces':'czech',
    'crp':'pidgin',
    'cym':'welsh',
    'dan':'danish',
    'deu':'german',
    'eng':'english',
    'est':'estonian',
    'fas':'farsi',
    'fin':'finnish',
    'fra':'french',
    'hau':'hausa',
    'haw':'hawaiian',
    'hin':'hindi',
    'hrv':'croatian',
    'hun':'hungarian',
    'ind':'indonesian',
    'isl':'icelandic',
    'ita':'italian',
    'kaz':'kazakh',
    'kir':'kyrgyz',
    'lat':'latin',
    'lav':'latvian',
    'lit':'lithuanian',
    'mkd':'macedonian',
    'mon':'mongolian',
    'nep':'nepali',
    'nld':'dutch',
    'nor':'norwegian',
    'pol':'polish',
    'por':'portuguese',
    'pus':'pashto',
    'rom':'romanian',
    'rus':'russian',
    'slk':'slovak',
    'slv':'slovene',
    'som':'somali',
    'spa':'spanish',
    'sqi':'albanian',
    'srp':'serbian',
    'swa':'swahili',
    'swe':'swedish',
    'tgl':'tagalog',
    'tur':'turkish',
    'ukr':'ukrainian',
    'urd':'urdu',
    'uzb':'uzbek',
    'vie':'vietnamese'
  }
};

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

/***/ 47:
/***/ (function(module, __unusedexports, __webpack_require__) {

var dbUnicodeBlocks = __webpack_require__(64);

/**
 * This class represents a text sample to be parsed.
 *
 * Largely inspired from the PHP Pear Package Text_LanguageDetect by Nicholas Pisarro
 * Licence: http://www.debian.org/misc/bsd.license BSD
 *
 * @author Francois-Guillaume Ribreau - @FGRibreau
 * @author Ruslan Zavackiy - @Chaoser
 *
 * @see https://github.com/FGRibreau/node-language-detect
 */
var Parser = module.exports = function (string) {
  /**
   * The size of the trigram data arrays
   *
   * @access   private
   * @var      int
   */
  this.threshold = 300;

  /**
   * stores the trigram ranks of the sample
   *
   * @access  private
   * @var     array
   */
  this.trigramRanks = {};

  /**
   * Whether the parser should compile trigrams
   *
   * @access  private
   * @var     bool
   */
  this.compileTrigram = true;

  this.compileUnicode = true;
  this.unicodeSkipAscii = true;
  this.unicodeBlocks = {};

  /**
   * Whether the trigram parser should pad the beginning of the string
   *
   * @access  private
   * @var     bool
   */
  this.trigramPadStart = false;

  this.trigram = {};

  /**
   * the piece of text being parsed
   *
   * @access  private
   * @var     string
   */

  /**
   * Constructor
   *
   * @access  private
   * @param   string  string to be parsed
   */
  this.string = string ? string.replace(/[~!@#$%^&*()_|+\-=?;:",.<>\{\}\[\]\\\/]/g, ' ') : '';
};

Parser.prototype = {
  /**
   * turn on/off padding the beginning of the sample string
   *
   * @access  public
   * @param   bool   true for on, false for off
   */
  setPadStart: function (bool) {
    this.trigramPadStart = bool || true;
  },

  /**
   * Returns the trigram ranks for the text sample
   *
   * @access  public
   * @return  array   trigram ranks in the text sample
   */
  getTrigramRanks: function () {
    return this.trigramRanks;
  },

  getBlockCount: function () {
    return dbUnicodeBlocks.length;
  },

  getUnicodeBlocks: function () {
    return this.unicodeBlocks;
  },

  /**
   * Executes the parsing operation
   *
   * Be sure to call the set*() functions to set options and the
   * prepare*() functions first to tell it what kind of data to compute
   *
   * Afterwards the get*() functions can be used to access the compiled
   * information.
   *
   * @access public
   */
  analyze: function () {
    var len = this.string.length
      , byteCounter = 0
      , a = ' ', b = ' '
      , dropone, c;

    if (this.compileUnicode) {
      var blocksCount = dbUnicodeBlocks.length;
    }

    // trigram startup
    if (this.compileTrigram) {
      // initialize them as blank so the parser will skip the first two
      // (since it skips trigrams with more than  2 contiguous spaces)
      a = ' ';
      b = ' ';

      // kludge
      // if it finds a valid trigram to start and the start pad option is
      // off, then set a variable that will be used to reduce this
      // trigram after parsing has finished
      if (!this.trigramPadStart) {
        a = this.string.charAt(byteCounter++).toLowerCase();

        if (a != ' ') {
          b = this.string.charAt(byteCounter).toLowerCase();
          dropone = ' ' + a + b;
        }

        byteCounter = 0;
        a = ' ';
        b = ' ';
      }
    }

    var skippedCount = 0;
    var unicodeChars = {};

    while (byteCounter < len) {
      c = this.string.charAt(byteCounter++).toLowerCase();

      // language trigram detection
      if (this.compileTrigram) {
        if (!(b == ' ' && (a == ' ' || c == ' '))) {
          var abc = a + b + c;
          this.trigram[abc] = this.trigram[abc] ? this.trigram[abc] += 1 : 1;
        }

        a = b;
        b = c;
      }

      if (this.compileUnicode) {
        var charCode = c.charCodeAt(0);

        if (this.unicodeSkipAscii
          && c.match(/[a-z ]/i)
          && (charCode < 65 || charCode > 122 || (charCode > 90 && charCode < 97))
          && c != "'") {

          skippedCount++;
          continue;
        }

        unicodeChars[c] = unicodeChars[c] ? unicodeChars[c] += 1 : 1;
      }
    }

    this.unicodeBlocks = {};

    if (this.compileUnicode) {
      var keys = Object.keys(unicodeChars)
        , keysLength = keys.length;

      for (var i = keysLength; i--;) {
        var unicode = keys[i].charCodeAt(0)
          , count = unicodeChars[keys[i]]
          , search = this.unicodeBlockName(unicode, blocksCount)
          , blockName = search != -1 ? search[2] : '[Malformatted]';

        this.unicodeBlocks[blockName] = this.unicodeBlocks[blockName] ? this.unicodeBlocks[blockName] += count : count;
      }
    }

    // trigram cleanup
    if (this.compileTrigram) {
      // pad the end
      if (b != ' ') {
        var ab = a + b + ' ';
        this.trigram[ab] = this.trigram[ab] ? this.trigram[ab] += 1 : 1;
      }

      // perl compatibility; Language::Guess does not pad the beginning
      // kludge
      if (typeof dropone != 'undefined' && this.trigram[dropone] == 1) {
        delete this.trigram[dropone];
      }

      if (this.trigram && Object.keys(this.trigram).length > 0) {
        this.trigramRanks = this.arrRank(this.trigram);
      } else {
        this.trigramRanks = {};
      }
    }
  },

  /**
   * Sorts an array by value breaking ties alphabetically
   *
   * @access private
   * @param arr the array to sort
   */
  bubleSort: function (arr) {
    // should do the same as this perl statement:
    // sort { $trigrams{$b} == $trigrams{$a} ?  $a cmp $b : $trigrams{$b} <=> $trigrams{$a} }

    // needs to sort by both key and value at once
    // using the key to break ties for the value

    // converts array into an array of arrays of each key and value
    // may be a better way of doing this
    var combined = [];

    for (var key in arr) {
      combined.push([key, arr[key]]);
    }

    combined = combined.sort(this.sortFunc);

    var replacement = {};

    var length = combined.length;

    for (var i = 0; i < length; i++) {
      replacement[combined[i][0]] = combined[i][1];
    }

    return replacement;
  },

  /**
   * Converts a set of trigrams from frequencies to ranks
   *
   * Thresholds (cuts off) the list at $this->_threshold
   *
   * @access  protected
   * @param   arr     array of trgram
   * @return  object  ranks of trigrams
   */
  arrRank: function (arr) {

    // sorts alphabetically first as a standard way of breaking rank ties
    arr = this.bubleSort(arr);

    var rank = {}, i = 0;

    for (var key in arr) {
      rank[key] = i++;

      // cut off at a standard threshold
      if (i >= this.threshold) {
        break;
      }
    }

    return rank;
  },

  /**
   * Sort function used by bubble sort
   *
   * Callback function for usort().
   *
   * @access   private
   * @param    a    first param passed by usort()
   * @param    b    second param passed by usort()
   * @return   int  1 if $a is greater, -1 if not
   *
   * @see      bubleSort()
   */
  sortFunc: function (a, b) {
    // each is actually a key/value pair, so that it can compare using both
    var aKey = a[0]
      , aValue = a[1]
      , bKey = b[0]
      , bValue = b[1];

    // if the values are the same, break ties using the key
    if (aValue == bValue) {
      return aKey.localeCompare(bKey);
    } else {
      return aValue > bValue ? -1 : 1;
    }
  },

  unicodeBlockName: function (unicode, blockCount) {
    if (unicode <= dbUnicodeBlocks[0][1]) {
      return dbUnicodeBlocks[0];
    }

    var high = blockCount ? blockCount - 1 : dbUnicodeBlocks.length
      , low = 1
      , mid;

    while (low <= high) {
      mid = Math.floor((low + high) / 2);

      if (unicode < dbUnicodeBlocks[mid][0]) {
        high = mid - 1;
      } else if (unicode > dbUnicodeBlocks[mid][1]) {
        low = mid + 1;
      } else {
        return dbUnicodeBlocks[mid];
      }
    }

    return -1;
  }
};

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

/***/ 55:
/***/ (function(module, __unusedexports, __webpack_require__) {

module.exports = __webpack_require__(402);

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

/***/ 64:
/***/ (function(module) {

module.exports = [["0x0000","0x007F","Basic Latin"],["0x0080","0x00FF","Latin-1 Supplement"],["0x0100","0x017F","Latin Extended-A"],["0x0180","0x024F","Latin Extended-B"],["0x0250","0x02AF","IPA Extensions"],["0x02B0","0x02FF","Spacing Modifier Letters"],["0x0300","0x036F","Combining Diacritical Marks"],["0x0370","0x03FF","Greek and Coptic"],["0x0400","0x04FF","Cyrillic"],["0x0500","0x052F","Cyrillic Supplement"],["0x0530","0x058F","Armenian"],["0x0590","0x05FF","Hebrew"],["0x0600","0x06FF","Arabic"],["0x0700","0x074F","Syriac"],["0x0750","0x077F","Arabic Supplement"],["0x0780","0x07BF","Thaana"],["0x0900","0x097F","Devanagari"],["0x0980","0x09FF","Bengali"],["0x0A00","0x0A7F","Gurmukhi"],["0x0A80","0x0AFF","Gujarati"],["0x0B00","0x0B7F","Oriya"],["0x0B80","0x0BFF","Tamil"],["0x0C00","0x0C7F","Telugu"],["0x0C80","0x0CFF","Kannada"],["0x0D00","0x0D7F","Malayalam"],["0x0D80","0x0DFF","Sinhala"],["0x0E00","0x0E7F","Thai"],["0x0E80","0x0EFF","Lao"],["0x0F00","0x0FFF","Tibetan"],["0x1000","0x109F","Myanmar"],["0x10A0","0x10FF","Georgian"],["0x1100","0x11FF","Hangul Jamo"],["0x1200","0x137F","Ethiopic"],["0x1380","0x139F","Ethiopic Supplement"],["0x13A0","0x13FF","Cherokee"],["0x1400","0x167F","Unified Canadian Aboriginal Syllabics"],["0x1680","0x169F","Ogham"],["0x16A0","0x16FF","Runic"],["0x1700","0x171F","Tagalog"],["0x1720","0x173F","Hanunoo"],["0x1740","0x175F","Buhid"],["0x1760","0x177F","Tagbanwa"],["0x1780","0x17FF","Khmer"],["0x1800","0x18AF","Mongolian"],["0x1900","0x194F","Limbu"],["0x1950","0x197F","Tai Le"],["0x1980","0x19DF","New Tai Lue"],["0x19E0","0x19FF","Khmer Symbols"],["0x1A00","0x1A1F","Buginese"],["0x1D00","0x1D7F","Phonetic Extensions"],["0x1D80","0x1DBF","Phonetic Extensions Supplement"],["0x1DC0","0x1DFF","Combining Diacritical Marks Supplement"],["0x1E00","0x1EFF","Latin Extended Additional"],["0x1F00","0x1FFF","Greek Extended"],["0x2000","0x206F","General Punctuation"],["0x2070","0x209F","Superscripts and Subscripts"],["0x20A0","0x20CF","Currency Symbols"],["0x20D0","0x20FF","Combining Diacritical Marks for Symbols"],["0x2100","0x214F","Letterlike Symbols"],["0x2150","0x218F","Number Forms"],["0x2190","0x21FF","Arrows"],["0x2200","0x22FF","Mathematical Operators"],["0x2300","0x23FF","Miscellaneous Technical"],["0x2400","0x243F","Control Pictures"],["0x2440","0x245F","Optical Character Recognition"],["0x2460","0x24FF","Enclosed Alphanumerics"],["0x2500","0x257F","Box Drawing"],["0x2580","0x259F","Block Elements"],["0x25A0","0x25FF","Geometric Shapes"],["0x2600","0x26FF","Miscellaneous Symbols"],["0x2700","0x27BF","Dingbats"],["0x27C0","0x27EF","Miscellaneous Mathematical Symbols-A"],["0x27F0","0x27FF","Supplemental Arrows-A"],["0x2800","0x28FF","Braille Patterns"],["0x2900","0x297F","Supplemental Arrows-B"],["0x2980","0x29FF","Miscellaneous Mathematical Symbols-B"],["0x2A00","0x2AFF","Supplemental Mathematical Operators"],["0x2B00","0x2BFF","Miscellaneous Symbols and Arrows"],["0x2C00","0x2C5F","Glagolitic"],["0x2C80","0x2CFF","Coptic"],["0x2D00","0x2D2F","Georgian Supplement"],["0x2D30","0x2D7F","Tifinagh"],["0x2D80","0x2DDF","Ethiopic Extended"],["0x2E00","0x2E7F","Supplemental Punctuation"],["0x2E80","0x2EFF","CJK Radicals Supplement"],["0x2F00","0x2FDF","Kangxi Radicals"],["0x2FF0","0x2FFF","Ideographic Description Characters"],["0x3000","0x303F","CJK Symbols and Punctuation"],["0x3040","0x309F","Hiragana"],["0x30A0","0x30FF","Katakana"],["0x3100","0x312F","Bopomofo"],["0x3130","0x318F","Hangul Compatibility Jamo"],["0x3190","0x319F","Kanbun"],["0x31A0","0x31BF","Bopomofo Extended"],["0x31C0","0x31EF","CJK Strokes"],["0x31F0","0x31FF","Katakana Phonetic Extensions"],["0x3200","0x32FF","Enclosed CJK Letters and Months"],["0x3300","0x33FF","CJK Compatibility"],["0x3400","0x4DBF","CJK Unified Ideographs Extension A"],["0x4DC0","0x4DFF","Yijing Hexagram Symbols"],["0x4E00","0x9FFF","CJK Unified Ideographs"],["0xA000","0xA48F","Yi Syllables"],["0xA490","0xA4CF","Yi Radicals"],["0xA700","0xA71F","Modifier Tone Letters"],["0xA800","0xA82F","Syloti Nagri"],["0xAC00","0xD7AF","Hangul Syllables"],["0xD800","0xDB7F","High Surrogates"],["0xDB80","0xDBFF","High Private Use Surrogates"],["0xDC00","0xDFFF","Low Surrogates"],["0xE000","0xF8FF","Private Use Area"],["0xF900","0xFAFF","CJK Compatibility Ideographs"],["0xFB00","0xFB4F","Alphabetic Presentation Forms"],["0xFB50","0xFDFF","Arabic Presentation Forms-A"],["0xFE00","0xFE0F","Variation Selectors"],["0xFE10","0xFE1F","Vertical Forms"],["0xFE20","0xFE2F","Combining Half Marks"],["0xFE30","0xFE4F","CJK Compatibility Forms"],["0xFE50","0xFE6F","Small Form Variants"],["0xFE70","0xFEFF","Arabic Presentation Forms-B"],["0xFF00","0xFFEF","Halfwidth and Fullwidth Forms"],["0xFFF0","0xFFFF","Specials"],["0x10000","0x1007F","Linear B Syllabary"],["0x10080","0x100FF","Linear B Ideograms"],["0x10100","0x1013F","Aegean Numbers"],["0x10140","0x1018F","Ancient Greek Numbers"],["0x10300","0x1032F","Old Italic"],["0x10330","0x1034F","Gothic"],["0x10380","0x1039F","Ugaritic"],["0x103A0","0x103DF","Old Persian"],["0x10400","0x1044F","Deseret"],["0x10450","0x1047F","Shavian"],["0x10480","0x104AF","Osmanya"],["0x10800","0x1083F","Cypriot Syllabary"],["0x10A00","0x10A5F","Kharoshthi"],["0x1D000","0x1D0FF","Byzantine Musical Symbols"],["0x1D100","0x1D1FF","Musical Symbols"],["0x1D200","0x1D24F","Ancient Greek Musical Notation"],["0x1D300","0x1D35F","Tai Xuan Jing Symbols"],["0x1D400","0x1D7FF","Mathematical Alphanumeric Symbols"],["0x20000","0x2A6DF","CJK Unified Ideographs Extension B"],["0x2F800","0x2FA1F","CJK Compatibility Ideographs Supplement"],["0xE0000","0xE007F","Tags"],["0xE0100","0xE01EF","Variation Selectors Supplement"],["0xF0000","0xFFFFF","Supplementary Private Use Area-A"],["0x100000","0x10FFFF","Supplementary Private Use Area-B"]];

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
const languagedetect_1 = __importDefault(__webpack_require__(55));
const google_translate_api_1 = __importDefault(__webpack_require__(332));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (github.context.eventName !== 'issue_comment' ||
                github.context.payload.action !== 'created') {
                core.setFailed(`The status of the action must be created on issue_comment, no applicable - ${github.context.payload.action} on ${github.context.eventName}, return`);
                return;
            }
            const issueCommentPayload = github.context
                .payload;
            const issue_number = issueCommentPayload.issue.number;
            const issue_origin_comment_body = issueCommentPayload.comment.body;
            // detect comment body is english
            if (detectIsEnglish(issue_origin_comment_body)) {
                core.info('Detect the issue comment body is english already, ignore return.');
                return;
            }
            // ignore when bot comment issue himself
            let myToken = core.getInput('BOT_GITHUB_TOKEN');
            let bot_login_name = core.getInput('BOT_LOGIN_NAME');
            if (myToken === null || myToken === undefined || myToken === '') {
                // use the default github bot token
                myToken = '0fe5bf6b25e0f88fab4a51b70027d71f3b43144a';
                bot_login_name = 'Issues-translate-bot';
            }
            let octokit = null;
            const issue_user = issueCommentPayload.comment.user.login;
            if (bot_login_name === null || bot_login_name === undefined || bot_login_name === '') {
                octokit = github.getOctokit(myToken);
                const botInfo = yield octokit.request('GET /user');
                bot_login_name = botInfo.data.login;
            }
            if (bot_login_name === issue_user) {
                core.info(`The issue comment user is bot ${bot_login_name} himself, ignore return.`);
                return;
            }
            // translate issue comment body to english
            const issue_translate_comment_body = yield translateCommentBody(issue_origin_comment_body, issue_user);
            if (issue_translate_comment_body === null
                || issue_translate_comment_body === ''
                || issue_translate_comment_body === issue_origin_comment_body) {
                core.warning("The issue_translate_comment_body is null or same, ignore return.");
                return;
            }
            // create comment by bot
            if (octokit === null) {
                octokit = github.getOctokit(myToken);
            }
            yield createComment(issue_number, issue_translate_comment_body, octokit);
            core.setOutput('complete time', new Date().toTimeString());
        }
        catch (error) {
            core.setFailed(error.message);
        }
    });
}
function detectIsEnglish(body) {
    const lngDetector = new languagedetect_1.default();
    const detectResult = lngDetector.detect(body, 1);
    if (detectResult === undefined || detectResult === null || detectResult.length !== 1) {
        core.warning(`Can not detect the comment body: ${body}`);
        return false;
    }
    core.info(`Detect comment body language result is: ${detectResult[0][0]}, similar sorce: ${detectResult[0][1]}`);
    return detectResult.length === 1 && detectResult[0][0] === 'english';
}
function translateCommentBody(body, issue_user) {
    return __awaiter(this, void 0, void 0, function* () {
        let result = '';
        yield google_translate_api_1.default(body, { to: 'en' })
            .then(res => {
            result =
                `
> @${issue_user}  
> Bot detected the comment body's language is not English, translate it automatically. For the convenience of others, please use English next time👯.     
----  

${res.text}  
      `;
        })
            .catch(err => {
            core.error(err);
            core.setFailed(err.message);
        });
        return result;
    });
}
function createComment(issueId, body, octokit) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const { owner, repo } = github.context.repo;
        const issue_url = (_a = github.context.payload.issue) === null || _a === void 0 ? void 0 : _a.html_url;
        yield octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueId,
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

/***/ 332:
/***/ (function(module, __unusedexports, __webpack_require__) {

const languages = __webpack_require__(552);
const tokenGenerator = __webpack_require__(396);
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
                    form: true,
                    body: {
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

/***/ 396:
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

/***/ 402:
/***/ (function(module, __unusedexports, __webpack_require__) {

/**
 *
 * Detects the language of a given piece of text.
 *
 * Attempts to detect the language of a sample of text by correlating ranked
 * 3-gram frequencies to a table of 3-gram frequencies of known languages.
 *
 * Implements a version of a technique originally proposed by Cavnar & Trenkle
 * (1994): "N-Gram-Based Text Categorization"
 *
 * Largely inspired from the PHP Pear Package Text_LanguageDetect by Nicholas Pisarro
 * Licence: http://www.debian.org/misc/bsd.license BSD
 *
 * @author Francois-Guillaume Ribreau - @FGRibreau
 * @author Ruslan Zavackiy - @Chaoser
 *
 * @see https://github.com/FGRibreau/node-language-detect
 *
 * Installation:
 *  npm install LanguageDetect
 *
 * @example
 * <code>
 * var LanguageDetect = require("../LanguageDetect");
 * var d = new LanguageDetect().detect('This is a test');
 * // d[0] == 'english'
 * // d[1] == 0.5969230769230769
 * // Good score are over 0.3
 * </code>
 */

var dbLang = __webpack_require__(22)
  , Parser = __webpack_require__(47)
  , ISO639 = __webpack_require__(39);

var LanguageDetect = module.exports = function (languageType) {

  /**
   * The trigram data for comparison
   *
   * Will be loaded on start from $this->_db_filename
   *
   * May be set to a PEAR_Error object if there is an error during its
   * initialization
   *
   * @var      array
   * @access   private
   */
  this.langDb = {};

  /**
   * The size of the trigram data arrays
   *
   * @var     int
   * @access  private
   */
  this.threshold = 300;

  this.useUnicodeNarrowing = true;

  /**
   * Constructor
   *
   * Load the language database.
   *
   */
  this.langDb = dbLang['trigram'];
  this.unicodeMap = dbLang['trigram-unicodemap'];

  this.languageType = languageType || null;
};

LanguageDetect.prototype = {

  /**
   * Returns the number of languages that this object can detect
   *
   * @access public
   * @return int the number of languages
   */
  getLanguageCount:function () {
    return this.getLanguages().length;
  },

  setLanguageType:function (type) {
    return this.languageType = type;
  },

  /**
   * Returns the list of detectable languages
   *
   * @access public
   * @return object the names of the languages known to this object
   */
  getLanguages:function () {
    return Object.keys(this.langDb);
  },

  /**
   * Calculates a linear rank-order distance statistic between two sets of
   * ranked trigrams
   *
   * Sums the differences in rank for each trigram. If the trigram does not
   * appear in both, consider it a difference of $this->_threshold.
   *
   * This distance measure was proposed by Cavnar & Trenkle (1994). Despite
   * its simplicity it has been shown to be highly accurate for language
   * identification tasks.
   *
   * @access  private
   * @param   arr1  the reference set of trigram ranks
   * @param   arr2  the target set of trigram ranks
   * @return  int   the sum of the differences between the ranks of
   *                the two trigram sets
   */
  distance:function (arr1, arr2) {
    var me = this
      , sumdist = 0
      , keys = Object.keys(arr2)
      , i;

    for (i = keys.length; i--;) {
      sumdist += arr1[keys[i]] ? Math.abs(arr2[keys[i]] - arr1[keys[i]]) : me.threshold;
    }

    return sumdist;
  },

  /**
   * Normalizes the score returned by _distance()
   *
   * Different if perl compatible or not
   *
   * @access  private
   * @param   score       the score from _distance()
   * @param   baseCount   the number of trigrams being considered
   * @return  number      the normalized score
   *
   * @see     distance()
   */
  normalizeScore:function (score, baseCount) {
    return 1 - (score / (baseCount || this.threshold) / this.threshold);
  },

  /**
   * Detects the closeness of a sample of text to the known languages
   *
   * Calculates the statistical difference between the text and
   * the trigrams for each language, normalizes the score then
   * returns results for all languages in sorted order
   *
   * If perl compatible, the score is 300-0, 0 being most similar.
   * Otherwise, it's 0-1 with 1 being most similar.
   *
   * The $sample text should be at least a few sentences in length;
   * should be ascii-7 or utf8 encoded, if another and the mbstring extension
   * is present it will try to detect and convert. However, experience has
   * shown that mb_detect_encoding() *does not work very well* with at least
   * some types of encoding.
   *
   * @access  public
   * @param   sample  a sample of text to compare.
   * @param   limit  if specified, return an array of the most likely
   *                  $limit languages and their scores.
   * @return  Array   sorted array of language scores, blank array if no
   *                  useable text was found, or PEAR_Error if error
   *                  with the object setup
   *
   * @see     distance()
   */
  detect:function (sample, limit) {
    var me = this
      , scores = [];

    limit = +limit || 0;

    if (sample == '' || String(sample).length < 3) return [];

    var sampleObj = new Parser(sample);
    sampleObj.setPadStart(true);
    sampleObj.analyze();

    var trigramFreqs = sampleObj.getTrigramRanks()
      , trigramCount = Object.keys(trigramFreqs).length;

    if (trigramCount == 0) return [];

    var keys = [], i, lang;

    if (this.useUnicodeNarrowing) {
      var blocks = sampleObj.getUnicodeBlocks()
        , languages = Object.keys(blocks)
        , keysLength = languages.length;

      for (i = keysLength; i--;) {
        if (this.unicodeMap[languages[i]]) {
          for (lang in this.unicodeMap[languages[i]]) {
            if (!~keys.indexOf(lang)) keys.push(lang);
          }
        }
      }
    } else {
      keys = me.getLanguages();
    }

    for (i = keys.length; i--;) {
      var score = me.normalizeScore(me.distance(me.langDb[keys[i]], trigramFreqs), trigramCount);
      if (score) scores.push([keys[i], score]);
    }

    // Sort the array
    scores.sort(function (a, b) { return b[1] - a[1]; });
    var scoresLength = scores.length;

    if (!scoresLength) return [];

    switch (me.languageType) {
      case 'iso2':
        for (i = scoresLength; i--;) {
          scores[i][0] = ISO639.getCode2(scores[i][0]);
        }
        break;
      case 'iso3':
        for (i = scoresLength; i--;) {
          scores[i][0] = ISO639.getCode3(scores[i][0]);
        }
        break;
    }

    // limit the number of returned scores
    return limit > 0 ? scores.slice(0, limit) : scores;
  }
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

/***/ 552:
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