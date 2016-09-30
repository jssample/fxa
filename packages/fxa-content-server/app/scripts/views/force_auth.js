/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

define(function (require, exports, module) {
  'use strict';

  var _ = require('underscore');
  var AuthErrors = require('lib/auth-errors');
  var BaseView = require('views/base');
  var Cocktail = require('cocktail');
  var FormView = require('views/form');
  var NullBehavior = require('views/behaviors/null');
  var p = require('lib/promise');
  var PasswordResetMixin = require('views/mixins/password-reset-mixin');
  var SignInView = require('views/sign_in');
  var Template = require('stache!templates/force_auth');
  var Transform = require('lib/transform');
  var Vat = require('lib/vat');

  var RELIER_DATA_SCHEMA = {
    email: Vat.email().required(),
    uid: Vat.uid().allow(null)
  };

  var proto = SignInView.prototype;

  var View = SignInView.extend({
    template: Template,
    className: 'force-auth',
    signInSubmitContext: 'force-auth',

    // used by the signin-mixin to decide which broker method to
    // call with which data when signin is successful.
    afterSignInBrokerMethod: 'afterForceAuth',
    afterSignInNavigateData: { clearQueryParams: true },

    _getAndValidateAccountData: function () {
      var fieldsToPick = ['email', 'uid'];
      var accountData = {};
      var relier = this.relier;

      fieldsToPick.forEach(function (fieldName) {
        if (relier.has(fieldName)) {
          accountData[fieldName] = relier.get(fieldName);
        }
      });

      return Transform.transformUsingSchema(
          accountData, RELIER_DATA_SCHEMA, AuthErrors);
    },

    beforeRender: function () {
      var self = this;
      var accountData;

      try {
        accountData = this._getAndValidateAccountData();
      } catch (err) {
        this.fatalError(err);
        return false;
      }

      /**
       * If the relier specifies a UID, check whether the UID is still
       * registered. If the uid is not registered, the account
       * was probably deleted. If the broker supports UID changes,
       * the user will still be allowed to signup or in, depending on
       * whether the email is registered. If not, show a useful error
       * and do not allow the user to continue.
       */
      var account = this.user.initAccount({
        email: accountData.email,
        uid: accountData.uid
      });

      if (accountData.uid) {
        return p.all([
          this.user.checkAccountEmailExists(account),
          this.user.checkAccountUidExists(account)
        ]).spread(function (emailExists, uidExists) {
          /*
           * uidExists: false, emailExists: false
           *   Let user sign up w/ email.
           * uidExists: true, emailExists: false
           *   Uid exists but doesn't match email, how'd this happen?
           *   Let the user sign up.
           * uidExists: false, emailExists: true
           *   Sign in w/ new uid.
           * uidExists: true, emailExists: true
           *   Assume for the same account, try to sign in
           */
          if (! emailExists) {
            return self._signUpIfUidChangeSupported(account);
          } if (! uidExists) {
            return self._signInIfUidChangeSupported(account);
          }

          // email and uid are both registered, continue as normal
        });
      } else {
        // relier did not specify a uid, there's a bit more flexibility.
        // If the email no longer exists, sign up the user.
        return this.user.checkAccountEmailExists(account)
          .then(function (emailExists) {
            if (! emailExists) {
              return self._navigateToForceSignUp(account);
            }
          });
      }
    },

    _signUpIfUidChangeSupported: function (account) {
      if (this.broker.hasCapability('allowUidChange')) {
        return this._navigateToForceSignUp(account);
      } else {
        this.model.set('error', AuthErrors.toError('DELETED_ACCOUNT'));
      }
    },

    _signInIfUidChangeSupported: function (account) {
      // if the broker supports a UID change, use force_auth to sign in,
      // otherwise print a big error message.
      if (! this.broker.hasCapability('allowUidChange')) {
        this.model.set('error', AuthErrors.toError('DELETED_ACCOUNT'));
      }
    },

    _navigateToForceSignUp: function (account) {
      // The default behavior of FxDesktop brokers is to halt before
      // the signup confirmation poll because about:accounts takes care
      // of polling and updating the UI. /force_auth is not opened in
      // about:accounts and unless beforeSignUpConfirmationPoll is
      // overridden, the user receives no visual feedback in this
      // tab once the verification is complete.
      this.broker.setBehavior(
          'beforeSignUpConfirmationPoll', new NullBehavior());

      return this.navigate(this.broker.transformLink('signup'), {
        error: AuthErrors.toError('DELETED_ACCOUNT'),
        forceEmail: account.get('email')
      });
    },

    _navigateToForceResetPassword: function () {
      return this.navigate(this.broker.transformLink('reset_password'), {
        forceEmail: this.relier.get('email')
      });
    },

    context: function () {
      return {
        email: this.relier.get('email'),
        fatalError: this.model.get('error'),
        password: this._formPrefill.get('password')
      };
    },

    events: _.extend({}, SignInView.prototype.events, {
      'click a[href="/reset_password"]': BaseView.cancelEventThen('_navigateToForceResetPassword')
    }),

    beforeDestroy: function () {
      this._formPrefill.set('password', this.getElementValue('.password'));
    },

    onSignInError: function (account, password, error) {
      if (AuthErrors.is(error, 'UNKNOWN_ACCOUNT')) {
        if (this.relier.has('uid')) {
          if (this.broker.hasCapability('allowUidChange')) {
            return this._navigateToForceSignUp(account);
          } else {
            this.displayError(AuthErrors.toError('DELETED_ACCOUNT'));
          }
        } else {
          return this._navigateToForceSignUp(account);
        }
      }

      return proto.onSignInError.call(this, account, password, error);
    },

    /**
     * Displays the account's avatar
     *
     * @returns {Promise}
     */
    afterVisible: function () {
      var email = this.relier.get('email');
      var account = this.user.getAccountByEmail(email);

      // Use FormView's afterVisible because SignIn attemps to
      // display a profile image for the "suggested" account.
      FormView.prototype.afterVisible.call(this);
      // Display the profile image if possible, otherwise show a placeholder.
      return this.displayAccountProfileImage(account, { spinner: true });
    }
  });

  Cocktail.mixin(
    View,
    PasswordResetMixin
  );

  module.exports = View;
});