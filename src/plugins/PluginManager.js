'use strict';

class PluginManager {
  constructor(context = {}) {
    this.context = context;
    this.plugins = new Map();
  }

  register(plugin) {
    if (!plugin || typeof plugin !== 'object') throw new Error('plugin 必须是对象');
    if (typeof plugin.name !== 'string' || !plugin.name) throw new Error('plugin.name 必填');
    if (typeof plugin.version !== 'string' || !plugin.version) throw new Error('plugin.version 必填');
    if (this.plugins.has(plugin.name)) throw new Error(`插件已存在: ${plugin.name}`);
    if (typeof plugin.install !== 'function') throw new Error('plugin.install 必须是函数');
    plugin.install(this.context);
    this.plugins.set(plugin.name, plugin);
    return { name: plugin.name, version: plugin.version };
  }

  get(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`插件未注册: ${name}`);
    return plugin;
  }

  list() {
    return Array.from(this.plugins.values()).map(p => ({ name: p.name, version: p.version }));
  }

  unregister(name) {
    const plugin = this.get(name);
    if (typeof plugin.deactivate === 'function') plugin.deactivate();
    this.plugins.delete(name);
    return { name };
  }
}

module.exports = { PluginManager };
