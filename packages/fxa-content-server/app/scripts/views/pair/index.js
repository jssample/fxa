/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import FormView from '../form';
import Cocktail from 'cocktail';
import Template from '../../templates/pair/index.mustache';
import UserAgentMixin from '../../lib/user-agent-mixin';
import PairingGraphicsMixin from '../mixins/pairing-graphics-mixin';

import PairingTotpMixin from './pairing-totp-mixin';
import { DOWNLOAD_LINK_PAIRING_APP } from '../../lib/constants';
import SyncAuthMixin from '../mixins/sync-auth-mixin';

class PairIndexView extends FormView {
  template = Template;

  submit () {
    return this.broker.openPairPreferences();
  }

  beforeRender () {
    const uap = this.getUserAgent();
    const isFirefoxDesktop = uap.isFirefoxDesktop();

    if (! isFirefoxDesktop) {
      // other browsers show an unsupported screen
      return this.replaceCurrentPage('pair/unsupported');
    }

    const account = this.broker.get('browserSignedInAccount');
    // If we reach this point that means we are in Firefox Desktop
    if (! account) {
      // if we are not logged into Sync then we offer to connect
      return this.replaceCurrentPage('connect_another_device');
    }

    if (! account.verified || ! account.sessionToken) {
      // if account is not verified or missing sessionToken then offer to sign in or confirm
      return window.location.href = this.getEscapedSyncUrl('signin', 'fxa:pair');
    }

    if (! this.broker.hasCapability('supportsPairing')) {
      return this.replaceCurrentPage('pair/unsupported');
    }

    return this.checkTotpStatus(account.sessionToken);
  }

  setInitialContext (context) {
    const graphicId = this.getGraphicsId();

    context.set({
      downloadAppLink: DOWNLOAD_LINK_PAIRING_APP,
      graphicId,
    });

  }
}

Cocktail.mixin(
  PairIndexView,
  PairingGraphicsMixin,
  PairingTotpMixin(),
  UserAgentMixin,
  SyncAuthMixin,
);

export default PairIndexView;
