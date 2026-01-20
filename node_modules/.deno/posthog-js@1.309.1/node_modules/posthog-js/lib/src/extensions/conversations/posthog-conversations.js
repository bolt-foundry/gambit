"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostHogConversations = void 0;
var globals_1 = require("../../utils/globals");
var logger_1 = require("../../utils/logger");
var core_1 = require("@posthog/core");
var logger = (0, logger_1.createLogger)('[Conversations]');
/**
 * Extract hostname from a domain string (handles URLs and plain hostnames)
 */
function extractHostname(domain) {
    // Remove protocol if present
    var hostname = domain.replace(/^https?:\/\//, '');
    // Remove path, query, port if present
    hostname = hostname.split('/')[0].split('?')[0].split(':')[0];
    return hostname || null;
}
/**
 * Check if the current domain matches the allowed domains list.
 * Returns true if:
 * - domains is empty or not present (no restriction)
 * - current hostname matches any allowed domain
 */
function isCurrentDomainAllowed(domains) {
    var _a;
    // No domain restriction - allow all
    if (!domains || domains.length === 0) {
        return true;
    }
    var currentHostname = (_a = globals_1.window === null || globals_1.window === void 0 ? void 0 : globals_1.window.location) === null || _a === void 0 ? void 0 : _a.hostname;
    if (!currentHostname) {
        // Can't determine hostname (SSR, etc.) - allow by default
        return true;
    }
    return domains.some(function (domain) {
        var allowedHostname = extractHostname(domain);
        if (!allowedHostname) {
            return false;
        }
        if (allowedHostname.startsWith('*.')) {
            // Wildcard match: *.example.com matches foo.example.com and example.com
            var pattern = allowedHostname.slice(2); // Remove "*."
            return currentHostname.endsWith(".".concat(pattern)) || currentHostname === pattern;
        }
        // Exact match
        return currentHostname === allowedHostname;
    });
}
var PostHogConversations = /** @class */ (function () {
    function PostHogConversations(_instance) {
        this._instance = _instance;
        // This is set to undefined until the remote config is loaded
        // then it's set to true if conversations are enabled
        // or false if conversations are disabled in the project settings
        this._isConversationsEnabled = undefined;
        this._conversationsManager = null;
        this._isInitializing = false;
        this._remoteConfig = null;
    }
    PostHogConversations.prototype.onRemoteConfig = function (response) {
        // Don't load conversations if disabled via config
        if (this._instance.config.disable_conversations) {
            return;
        }
        var conversations = response['conversations'];
        if ((0, core_1.isNullish)(conversations)) {
            return;
        }
        // Handle both boolean and object response
        if ((0, core_1.isBoolean)(conversations)) {
            this._isConversationsEnabled = conversations;
        }
        else {
            // It's a ConversationsRemoteConfig object
            this._isConversationsEnabled = conversations.enabled;
            this._remoteConfig = conversations;
        }
        this.loadIfEnabled();
    };
    PostHogConversations.prototype.reset = function () {
        var _a;
        // Delegate cleanup to the lazy-loaded manager (which knows about persistence keys)
        // If not loaded, there's nothing to reset anyway
        (_a = this._conversationsManager) === null || _a === void 0 ? void 0 : _a.reset();
        this._conversationsManager = null;
        // Reset local state
        this._isConversationsEnabled = undefined;
        this._remoteConfig = null;
    };
    PostHogConversations.prototype.loadIfEnabled = function () {
        var _this = this;
        if (this._conversationsManager) {
            return;
        }
        if (this._isInitializing) {
            return;
        }
        if (this._instance.config.disable_conversations) {
            return;
        }
        if (this._instance.config.cookieless_mode && this._instance.consent.isOptedOut()) {
            return;
        }
        var phExtensions = globals_1.assignableWindow === null || globals_1.assignableWindow === void 0 ? void 0 : globals_1.assignableWindow.__PosthogExtensions__;
        if (!phExtensions) {
            return;
        }
        // Wait for remote config to load
        if ((0, core_1.isUndefined)(this._isConversationsEnabled)) {
            return;
        }
        // Check if conversations are enabled
        if (!this._isConversationsEnabled) {
            return;
        }
        // Check if we have the required config
        if (!this._remoteConfig || !this._remoteConfig.token) {
            logger.error('Conversations enabled but missing token in remote config.');
            return;
        }
        // Check if current domain is allowed
        if (!isCurrentDomainAllowed(this._remoteConfig.domains)) {
            return;
        }
        this._isInitializing = true;
        try {
            var initConversations = phExtensions.initConversations;
            if (initConversations) {
                // Conversations code is already loaded
                this._completeInitialization(initConversations);
                this._isInitializing = false;
                return;
            }
            // If we reach here, conversations code is not loaded yet
            var loadExternalDependency = phExtensions.loadExternalDependency;
            if (!loadExternalDependency) {
                this._handleLoadError('PostHog loadExternalDependency extension not found.');
                return;
            }
            // Load the conversations bundle
            loadExternalDependency(this._instance, 'conversations', function (err) {
                if (err || !phExtensions.initConversations) {
                    _this._handleLoadError('Could not load conversations script', err);
                }
                else {
                    _this._completeInitialization(phExtensions.initConversations);
                }
                _this._isInitializing = false;
            });
        }
        catch (e) {
            this._handleLoadError('Error initializing conversations', e);
            this._isInitializing = false;
        }
    };
    /** Helper to finalize conversations initialization */
    PostHogConversations.prototype._completeInitialization = function (initConversationsFn) {
        if (!this._remoteConfig) {
            logger.error('Cannot complete initialization: remote config is null');
            return;
        }
        try {
            // Pass config and PostHog instance to the extension
            this._conversationsManager = initConversationsFn(this._remoteConfig, this._instance);
            logger.info('Conversations loaded successfully');
        }
        catch (e) {
            this._handleLoadError('Error completing conversations initialization', e);
        }
    };
    /** Helper to handle initialization errors */
    PostHogConversations.prototype._handleLoadError = function (message, error) {
        logger.error(message, error);
        this._conversationsManager = null;
        this._isInitializing = false;
    };
    /**
     * Show the conversations widget (button and chat panel)
     */
    PostHogConversations.prototype.enable = function () {
        if (!this._conversationsManager) {
            logger.warn('Conversations not loaded yet.');
            return;
        }
        this._conversationsManager.enable();
    };
    /**
     * Hide the conversations widget completely (button and chat panel)
     */
    PostHogConversations.prototype.disable = function () {
        if (!this._conversationsManager) {
            return;
        }
        this._conversationsManager.disable();
    };
    /**
     * Check if conversations are currently loaded and available
     */
    PostHogConversations.prototype.isLoaded = function () {
        return !(0, core_1.isNull)(this._conversationsManager);
    };
    /**
     * Check if conversations are enabled (based on remote config)
     */
    PostHogConversations.prototype.isEnabled = function () {
        return this._isConversationsEnabled === true;
    };
    return PostHogConversations;
}());
exports.PostHogConversations = PostHogConversations;
//# sourceMappingURL=posthog-conversations.js.map