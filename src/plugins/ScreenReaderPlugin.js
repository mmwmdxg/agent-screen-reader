'use strict';

const { ScreenCapture } = require('../screen-capture/ScreenCapture');
const { FeedBrowser } = require('../screen-capture/FeedBrowser');

function createScreenReaderPlugin() {
  let capture = null;
  let feed = null;
  let state = 'registered';
  let context = {};

  return {
    name: 'screen-reader',
    version: '1.1.0',

    install(ctx) {
      context = ctx || {};
      capture = new ScreenCapture(context.captureOptions || {});
      feed = new FeedBrowser(capture, context.feedOptions || {});
      capture.on('frame', (meta) => {
        if (typeof context.onFrame === 'function') context.onFrame(meta);
      });
      feed.on('feed-frame', (item) => {
        if (typeof context.onFeedFrame === 'function') context.onFeedFrame(item);
      });
      state = 'installed';
    },

    activate() {
      if (!capture) throw new Error('插件尚未 install');
      state = 'active';
      return this.getApi();
    },

    deactivate() {
      if (feed) feed.feedStop();
      if (capture) capture.stop();
      state = 'inactive';
    },

    getApi() {
      if (!capture) throw new Error('插件尚未 install');
      return {
        snapshot: (opts) => capture.captureOnce(opts),
        streamStart: (opts) => capture.startStream(opts),
        streamStop: () => capture.stop(),
        setEnabled: (v) => {
          const result = capture.setEnabled(v);
          if (v === false && feed) feed.onDisabled();
          return result;
        },
        status: () => ({ pluginState: state, ...capture.status() }),
        feedStart: (opts) => feed.feedStart(opts),
        feedOnce: (opts) => feed.feedOnce(opts),
        feedStop: () => feed.feedStop(),
        feedStatus: () => ({ pluginState: state, ...feed.status() })
      };
    }
  };
}

module.exports = { createScreenReaderPlugin };
