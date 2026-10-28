import {useFullPeer} from '@stores/fullPeers';
import {createEffect, createMemo} from 'solid-js';
import usePeerLanguage from '@stores/peerLanguage';
import useDynamicCachedValue from '@helpers/solid/useDynamicCachedValue';
import I18n from '@lib/langPack';
import {useAppSettings} from '@stores/appSettings';
import {useAppState} from '@stores/appState';

function _usePeerTranslation(peerId: PeerId) {
  const [appSettings, setAppSettings] = useAppSettings();
  const [appState] = useAppState();

  const fullPeer = useFullPeer(peerId);
  const peerLanguage = usePeerLanguage(() => peerId, true);

  const areTranslationsAvailable = (manual?: boolean) => {
    if(appState.appConfig.freeze_since_date) {
      return false;
    }

    const appConfig = appState?.appConfig;
    if((manual ? appConfig?.translations_manual_enabled : appConfig?.translations_auto_enabled) !== 'enabled') {
      return false;
    }

    return true;
  };

  const canTranslate = (manual?: boolean) => {
    if(!areTranslationsAvailable(manual)) {
      return false;
    }

    // * PlumaGram: the whole chat is translated without Premium, through the same per-message translation
    return true;
  };

  const shouldShow = createMemo<boolean | undefined>(() => {
    if(!canTranslate() || !peerLanguage() || !appSettings.translations.enabled) {
      return;
    }

    const _fullPeer = fullPeer();
    if(
      (!_fullPeer || ('pFlags' in _fullPeer && _fullPeer.pFlags.translations_disabled)) ||
      appSettings.translations.doNotTranslate.includes(peerLanguage())
    ) {
      return false;
    }

    return true;
  });

  const ret = {
    peerLanguage,
    language: (): TranslatableLanguageISO => (appSettings.translations.peers[peerId] || I18n.langCodeNormalized()) as any,
    setLanguage: (lang: string) => setAppSettings('translations', 'peers', peerId, lang),
    // * PlumaGram: turned on by hand, the chat is translated even before its language is detected
    enabled: createMemo(() => !!(canTranslate() && appSettings.translations.enabled && appSettings.translations.enabledPeers[peerId]) && shouldShow() !== false),
    toggle: (enabled: boolean) => setAppSettings('translations', 'enabledPeers', peerId, enabled ? true : undefined),
    shouldShow,
    canTranslate,
    areTranslationsAvailable
  } as const;

  createEffect(() => {
    if(ret.shouldShow() === false && ret.enabled()) {
      ret.toggle(false);
    }
  });

  return ret;
}

export default function usePeerTranslation(peerId: PeerId) {
  return useDynamicCachedValue(() => 'usePeerTranslation-' + peerId, () => _usePeerTranslation(peerId))();
}
