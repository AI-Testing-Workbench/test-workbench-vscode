/**
 * dsh-plugin-offline — browser half.
 *
 * Adds two seats on the shipped Plugins page (`dsh-client-ui-plugin-manager`):
 *
 * - `plugins.tab`: an "Offline Export" tab that lists the profile's installed
 *   plugins with one export button per row, lets the person choose the export
 *   folder, and hosts the offline-import entry (pick a `.tgz`, confirm, upload).
 * - `plugins.detail.actions`: an "Export offline" button on every installed
 *   plugin's detail page, next to its enable switch and uninstall action.
 *
 * There is no per-card action seat on the installed list itself, so the export
 * button lives on the detail page opened from that list and in this tab; both
 * call the same Host endpoints (`/dsh-offline/api/v1/*`), which run the same
 * `exportPlugin`/`importArtifact` pipelines as the agent's `plugin_offline` tool.
 * Export goes out through a JSON request; import streams the chosen file as an
 * upload so large artifacts never pass through the page as base64.
 *
 * Build note: this file is the shipped artifact, hand-authored in the
 * `window.__ModuleLoader__.load({ id, factory })` protocol the client module
 * system expects. It uses only the React baseline (no client package imports,
 * no primitives), reads state through the page's own services, and styles with
 * `--dsw-alias-*` theme tokens so light/dark follows the app.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-offline',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-offline';
    const API = '/dsh-offline/api/v1';
    const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

    const MESSAGES = {
      en: {
        tabLabel: 'Import & Export',
        title: 'Import and export plugins',
        intro:
          'Pack one plugin and its whole dependency closure into a single tarball that installs on an isolated machine without network access, '
          + 'or import such a tarball produced on another machine. The export folder is chosen for every export.',
        refresh: 'Refresh',
        loading: 'Loading installed plugins…',
        export: 'Export offline',
        exporting: 'Exporting…',
        exported: 'Exported',
        failed: 'Failed',
        empty: 'This profile has no installed plugins that can be exported.',
        enabled: 'Enabled',
        disabled: 'Disabled',
        warnings: 'warnings',
        detailHint: 'Export this plugin with its dependency closure',
        choosingFolder: 'Choosing folder…',
        pickerFailed: 'Could not open the folder picker.',
        noPickerFallback: 'This Host has no folder picker, so the default artifacts folder was used.',
        importTitle: 'Import an offline plugin',
        importIntro:
          'Choose a .tgz produced by "Export offline" on another machine and install it into this profile. '
          + 'The file is copied to the artifacts folder first, because the profile records that path as the dependency source.',
        chooseFile: 'Choose .tgz file',
        confirmImport: 'Import into this profile',
        cancel: 'Cancel',
        importing: 'Importing…',
        importDone: 'Imported',
        activationRestart: 'Installed. Restart DSH to finish activating it.',
        activationOverridden: 'Installed, but a higher-priority configuration overrides this bundle.',
        activationFailed: 'Installed, but activation failed. Check the plugin page for details.',
        activationCancelled: 'Installed, but activation was cancelled.',
        uploading: 'Uploading',
        openPlugin: 'View plugin details',
        importHint: 'Only dsh-plugin-offline artifacts are accepted here.',
        fileTooLarge: 'This file is larger than the 1 GB import limit.',
      },
      zh: {
        tabLabel: '导入导出',
        title: '插件导入与导出',
        intro:
          '把一个插件及其整棵依赖闭包打包成单个压缩包，'
          + '并支持导入离线包，实现无网环境下安装使用插件。',
        refresh: '刷新',
        loading: '正在读取已安装插件…',
        export: '导出离线包',
        exporting: '正在导出…',
        exported: '已导出',
        failed: '失败',
        empty: '当前 profile 没有可导出的已安装插件。',
        enabled: '已启用',
        disabled: '已停用',
        warnings: '条警告',
        detailHint: '连同依赖闭包导出该插件',
        choosingFolder: '正在选择目录…',
        pickerFailed: '无法打开目录选择器。',
        noPickerFallback: '当前 Host 没有目录选择器，已写入默认产物目录。',
        importTitle: '导入离线插件',
        importIntro:
          '选择在其他机器上由「导出离线包」生成的 .tgz，并安装到当前 profile。'
          + '文件会先复制到产物目录，因为 profile 会把这个路径记为该依赖的来源。',
        chooseFile: '选择 .tgz 文件',
        confirmImport: '导入到当前 profile',
        cancel: '取消',
        importing: '正在导入…',
        importDone: '导入成功',
        activationRestart: '已安装；重启 DSH 后完成启用。',
        activationOverridden: '已安装，但更高优先级的配置覆盖了这个 bundle。',
        activationFailed: '已安装，但启用失败；请在插件页查看详情。',
        activationCancelled: '已安装，但启用被取消。',
        uploading: '上传中',
        openPlugin: '查看插件详情',
        importHint: '这里只接受 dsh-plugin-offline 生成的产物。',
        fileTooLarge: '文件超过 1 GB 的导入上限。',
      },
    };

    const FALLBACK_LOCALE = 'en';

    /** Replace `{name}` placeholders in one dictionary string. */
    function format(text, vars) {
      if (typeof text !== 'string' || vars === undefined) return text;
      return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
        Object.hasOwn(vars, name) ? String(vars[name]) : match);
    }

    /** The active locale id, falling back to English when the service is absent. */
    function activeLocale(ctx) {
      const locale = ctx.get('locale');
      const active = locale === undefined ? undefined : locale.getSnapshot?.().active;
      return active === 'zh' ? 'zh' : active === 'en' ? 'en' : FALLBACK_LOCALE;
    }

    /** Translate one key outside React (tab labels are resolved on every render). */
    function translateStatic(ctx, key, vars) {
      const locale = ctx.get('locale');
      const bound = locale !== undefined && typeof locale.bind === 'function' ? locale.bind(NS) : undefined;
      const boundText = bound === undefined ? undefined : bound(key);
      // rc.3 returns the key itself for a missing namespace/entry, so only use
      // the bound result when it actually resolved something.
      const text = boundText !== undefined && boundText !== key
        ? boundText
        : MESSAGES[activeLocale(ctx)][key] ?? key;
      return format(text, vars);
    }

    /** Call one JSON endpoint on this plugin's Host half. */
    async function callApi(path, init) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store', ...init });
      const text = await response.text();
      let payload;
      try {
        payload = text === '' ? {} : JSON.parse(text);
      } catch {
        throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
      }
      if (response.ok !== true || payload?.ok === false) {
        const error = new Error(payload?.message ?? `HTTP ${response.status}`);
        error.code = payload?.code;
        throw error;
      }
      return payload;
    }

    /** Human-readable byte size. */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Upload one artifact as an octet-stream (XHR, so upload progress is
     * available for large plugins) and install it on the Host.
     * @param file - the chosen browser File.
     * @param onProgress - receives integer percentages while uploading.
     * @returns the Host response payload.
     */
    function uploadArtifact(file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API}/import`);
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        xhr.setRequestHeader('x-dsh-offline-import', '1');
        xhr.upload.onprogress = (event) => {
          if (onProgress === undefined || event.lengthComputable !== true) return;
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onerror = () => reject(new Error('Network error while uploading the artifact.'));
        xhr.onabort = () => reject(new Error('Upload cancelled.'));
        xhr.onload = () => {
          let payload;
          try {
            payload = xhr.responseText === '' ? {} : JSON.parse(xhr.responseText);
          } catch {
            reject(new Error(`HTTP ${xhr.status}: ${String(xhr.responseText).slice(0, 200)}`));
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300 || payload?.ok === false) {
            const error = new Error(payload?.message ?? `HTTP ${xhr.status}`);
            error.code = payload?.code;
            reject(error);
            return;
          }
          resolve(payload);
        };
        xhr.send(file);
      });
    }

    /**
     * Map the profile manager's activation outcome to a localized notice.
     * `applied` is the normal case and adds no text — the success line already says
     * the import worked; only outcomes the person must act on are surfaced.
     * @param t - translate function.
     * @param application - `ChangeResult.application`, or undefined.
     * @returns `{ text, tone: 'warn' | 'error' }`, or undefined for applied.
     */
    function applicationNotice(t, application) {
      if (typeof application !== 'string' || application === '' || application === 'applied') return undefined;
      if (application === 'failed') return { text: t('activationFailed'), tone: 'error' };
      if (application === 'restart-required') return { text: t('activationRestart'), tone: 'warn' };
      if (application === 'overridden') return { text: t('activationOverridden'), tone: 'warn' };
      if (application === 'cancelled') return { text: t('activationCancelled'), tone: 'warn' };
      return undefined;
    }

    const CSS = `
.dsh-offline-root{display:flex;flex-direction:column;gap:14px;padding:2px 2px 28px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5}
.dsh-offline-head{display:flex;flex-direction:column;gap:5px}
.dsh-offline-title{margin:0;font-size:15px;font-weight:600}
.dsh-offline-desc{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.55}
.dsh-offline-meta{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dsh-offline-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:2px 6px;word-break:break-all}
.dsh-offline-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-offline-list{display:flex;flex-direction:column;gap:10px}
.dsh-offline-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px 14px}
.dsh-offline-rowmain{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-offline-name{display:flex;align-items:center;gap:8px;font-weight:600;flex-wrap:wrap}
.dsh-offline-version{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400}
.dsh-offline-tag{font-size:11px;font-weight:400;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.dsh-offline-rowdesc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-offline-actions{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto;max-width:340px}
.dsh-offline-button{height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;font-weight:400;line-height:1;cursor:pointer;white-space:nowrap;transition:background .12s ease}
.dsh-offline-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-offline-button:active:not(:disabled){background:var(--dsw-alias-bg-overlay)}
.dsh-offline-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-offline-button:disabled{opacity:.55;cursor:default}
.dsh-offline-result{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:1.45;text-align:right;word-break:break-all}
.dsh-offline-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.45;text-align:right;word-break:break-all}
.dsh-offline-warn{margin:0;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:1.45;text-align:right}
.dsh-offline-sep{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:6px 0 2px}
.dsh-offline-file{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-offline-progress{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.dsh-offline-import-result{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:10px 12px}
.dsh-offline-import-result .dsh-offline-result{align-self:stretch;text-align:left;max-width:none;font-size:12px}
.dsh-offline-import-result .dsh-offline-meta{align-self:stretch;text-align:left;max-width:none;font-size:12px}
.dsh-offline-import-result .dsh-offline-warn{align-self:stretch;text-align:left;max-width:none;font-size:12px}
.dsh-offline-import-result .dsh-offline-error{align-self:stretch;text-align:left;max-width:none;font-size:12px}
.dsh-offline-import-result .dsh-offline-code{display:block;white-space:normal;word-break:break-all;font-size:12px}
.dsh-offline-import-result .dsh-offline-button{align-self:flex-start;margin-top:2px}
`;

    /** One-time styles for this module's UI (unmounted with the component). */
    function StyleSheet() {
      return h('style', { key: 'dsh-offline-style' }, CSS);
    }

    /**
     * Build the module's components once per Client run, so React sees stable
     * component identities across page re-renders (state survives; hooks stay in
     * the same order). Every component closes over this run's `ctx`.
     * @param ctx - the browser plugin context.
     */
    function createUi(ctx) {
      /**
       * Resolve the folder picker when a click happens, not while the plugin
       * applies. DSH may start `uiWorkspace` after this plugin's fiber (the
       * client half only injects `slots` in rc.3), so a value captured here
       * would stay `undefined` for the page's lifetime.
       */
      function folderPicker() {
        const workspace = ctx.get('uiWorkspace');
        return workspace !== undefined && typeof workspace.pickDirectory === 'function' ? workspace : undefined;
      }

      /** A translate function plus a locale subscription so mounted UI follows a language switch. */
      function useT() {
        const locale = ctx.get('locale');
        const [, forceRender] = React.useState(0);
        React.useEffect(() => {
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          return locale.subscribe(() => forceRender((value) => value + 1));
        }, [locale]);
        return React.useCallback((key, vars) => translateStatic(ctx, key, vars), [ctx, locale]);
      }

      /**
       * The export button plus its per-click progress and result line.
       * @param props.plugin - bundle name to export.
       * @param props.output - optional chosen output directory.
       * @param props.showPath - render the artifact path inline (tab rows) instead of a tooltip.
       */
      function ExportControl({ plugin, showPath }) {
        const t = useT();
        const [state, setState] = React.useState({ status: 'idle' });
        const onClick = React.useCallback(async () => {
          // Every export asks where to write first; cancelling the picker aborts
          // the export. A Host without a folder picker falls back to the default
          // artifacts folder and says so in the result line.
          let output;
          let pickedHere = false;
          const picker = folderPicker();
          if (picker !== undefined) {
            setState({ status: 'picking' });
            let picked;
            try {
              picked = await picker.pickDirectory();
            } catch (error) {
              setState({ status: 'error', message: `${t('pickerFailed')} ${error instanceof Error ? error.message : String(error)}` });
              return;
            }
            if (typeof picked !== 'string' || picked === '') {
              setState({ status: 'idle' });
              return;
            }
            output = picked;
            pickedHere = true;
          }
          setState({ status: 'busy' });
          try {
            const payload = await callApi('/export', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ plugin, ...(output === undefined ? {} : { output }) }),
            });
            setState({ status: 'done', result: payload.result, picked: pickedHere });
          } catch (error) {
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        }, [plugin, t]);
        const busy = state.status === 'busy' || state.status === 'picking';
        const result = state.status === 'done' ? state.result : undefined;
        const warningCount = typeof result?.warningCount === 'number' ? result.warningCount : (result?.warnings?.length ?? 0);
        return h('div', { className: 'dsh-offline-actions' },
          h(StyleSheet),
          h('button', {
            type: 'button',
            className: 'dsh-offline-button',
            disabled: busy,
            onClick,
            title: t('detailHint'),
            'aria-label': `${t('export')} ${plugin}`,
          }, state.status === 'picking' ? t('choosingFolder') : busy ? t('exporting') : t('export')),
          result === undefined ? null : h('p', {
            className: 'dsh-offline-result',
            role: 'status',
            title: result.artifact,
          },
          `${t('exported')} · ${formatBytes(result.bytes)}`,
          showPath === true ? h('code', { className: 'dsh-offline-code' }, result.artifact) : null),
          state.status === 'done' && state.picked !== true ? h('p', { className: 'dsh-offline-meta' }, t('noPickerFallback')) : null,
          warningCount > 0 ? h('p', { className: 'dsh-offline-warn' }, `${warningCount} ${t('warnings')}`) : null,
          state.status === 'error' ? h('p', { className: 'dsh-offline-error', role: 'alert' }, `${t('failed')}: ${state.message}`) : null);
      }

      /** One installed-bundle row inside the offline tab. */
      function BundleRow({ bundle }) {
        const t = useT();
        return h('div', { className: 'dsh-offline-row' },
          h('div', { className: 'dsh-offline-rowmain' },
            h('div', { className: 'dsh-offline-name' },
              h('span', null, bundle.name),
              typeof bundle.version === 'string' ? h('span', { className: 'dsh-offline-version' }, bundle.version) : null,
              h('span', { className: 'dsh-offline-tag' }, bundle.enabled === true ? t('enabled') : t('disabled'))),
            typeof bundle.description === 'string' && bundle.description !== ''
              ? h('p', { className: 'dsh-offline-rowdesc', title: bundle.description }, bundle.description)
              : null),
          h(ExportControl, { plugin: bundle.name, showPath: true }));
      }

      /** The Plugins detail-page seat: render only for an installed profile bundle. */
      function DetailExportAction({ subject }) {
        const pkg = subject !== null && typeof subject === 'object' && subject.kind === 'bundle' ? subject.pkg : undefined;
        if (pkg === undefined || pkg === null || pkg.installed !== true || typeof pkg.name !== 'string') return null;
        return h(ExportControl, { plugin: pkg.name, showPath: false });
      }

      /** The import section: pick a tarball, confirm, upload, install, then offer the plugin page. */
      function ImportSection({ onImported, openPackage }) {
        const t = useT();
        const inputRef = React.useRef(null);
        const [file, setFile] = React.useState(undefined);
        const [state, setState] = React.useState({ status: 'idle' });

        const onChoose = React.useCallback(() => {
          if (inputRef.current !== null) {
            inputRef.current.value = '';
            inputRef.current.click();
          }
        }, []);
        const onFileChange = React.useCallback((event) => {
          const chosen = event.target.files?.[0];
          if (chosen === undefined) return;
          if (chosen.size > MAX_IMPORT_BYTES) {
            setFile(undefined);
            setState({ status: 'error', message: translateStatic(ctx, 'fileTooLarge') });
            return;
          }
          setFile(chosen);
          setState({ status: 'ready' });
        }, []);
        const onCancel = React.useCallback(() => {
          setFile(undefined);
          setState({ status: 'idle' });
        }, []);
        const onConfirm = React.useCallback(async () => {
          if (file === undefined) return;
          setState({ status: 'uploading', percent: 0 });
          try {
            const payload = await uploadArtifact(file, (percent) => {
              setState((current) => current.status === 'uploading' ? { status: 'uploading', percent } : current);
            });
            setState({ status: 'done', result: payload });
            setFile(undefined);
            if (onImported !== undefined) onImported();
          } catch (error) {
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        }, [file, onImported]);

        const busy = state.status === 'uploading';
        const result = state.status === 'done' ? state.result : undefined;
        return h('section', { className: 'dsh-offline-head' },
          h(StyleSheet),
          h('h4', { className: 'dsh-offline-title' }, t('importTitle')),
          h('p', { className: 'dsh-offline-desc' }, t('importIntro')),
          h('p', { className: 'dsh-offline-meta' }, t('importHint')),
          h('input', {
            ref: inputRef,
            type: 'file',
            accept: '.tgz,.tar.gz,application/gzip',
            style: { display: 'none' },
            onChange: onFileChange,
          }),
          busy ? h('p', { className: 'dsh-offline-progress', role: 'status' }, `${t('uploading')}… ${state.percent}%`) : null,
          file === undefined ? null : h('div', { className: 'dsh-offline-file' },
            h('code', { className: 'dsh-offline-code' }, `${file.name} · ${formatBytes(file.size)}`),
            h('button', { type: 'button', className: 'dsh-offline-button', disabled: busy, onClick: onConfirm }, busy ? t('importing') : t('confirmImport')),
            h('button', { type: 'button', className: 'dsh-offline-button', disabled: busy, onClick: onCancel }, t('cancel'))),
          file !== undefined || busy ? null : h('div', { className: 'dsh-offline-toolbar' },
            h('button', { type: 'button', className: 'dsh-offline-button', onClick: onChoose }, t('chooseFile'))),
          result === undefined ? null : h('div', { className: 'dsh-offline-import-result' },
            h('p', { className: 'dsh-offline-result', role: 'status' }, `${t('importDone')} · ${result.plugin.name}@${result.plugin.version}`),
            h('p', { className: 'dsh-offline-meta' }, h('code', { className: 'dsh-offline-code' }, result.artifact)),
            (() => {
              const notice = applicationNotice(t, result.install?.application);
              if (notice === undefined) return null;
              return h('p', { className: notice.tone === 'error' ? 'dsh-offline-error' : 'dsh-offline-warn' }, notice.text);
            })(),
            Array.isArray(result.warnings) && result.warnings.length > 0
              ? h('p', { className: 'dsh-offline-warn' }, result.warnings.join(' '))
              : null,
            typeof result.plugin.name === 'string' && openPackage !== undefined
              ? h('button', {
                type: 'button',
                className: 'dsh-offline-button',
                onClick: () => openPackage(result.plugin.name),
              }, t('openPlugin'))
              : null),
          state.status === 'error' ? h('p', { className: 'dsh-offline-error', role: 'alert' }, `${t('failed')}: ${state.message}`) : null);
      }

      /** The "Offline Export" tab on the Plugins page. */
      function OfflineTab({ openPackage }) {
        const t = useT();
        const [state, setState] = React.useState({ status: 'loading' });
        const load = React.useCallback(async () => {
          setState((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading' }));
          try {
            const payload = await callApi('/bundles');
            setState({ status: 'ready', bundles: Array.isArray(payload.bundles) ? payload.bundles : [] });
          } catch (error) {
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        }, []);
        React.useEffect(() => {
          load();
        }, [load]);
        const bundles = state.status === 'ready' ? state.bundles : [];
        return h('div', { className: 'dsh-offline-root' },
          h(StyleSheet),
          h('header', { className: 'dsh-offline-head' },
            h('h3', { className: 'dsh-offline-title' }, t('title')),
            h('p', { className: 'dsh-offline-desc' }, t('intro'))),
          h('div', { className: 'dsh-offline-toolbar' },
            h('button', {
              type: 'button',
              className: 'dsh-offline-button',
              onClick: load,
              disabled: state.status === 'loading',
            }, t('refresh'))),
          state.status === 'loading' ? h('p', { className: 'dsh-offline-meta', role: 'status' }, t('loading')) : null,
          state.status === 'error' ? h('p', { className: 'dsh-offline-error', role: 'alert' }, `${t('failed')}: ${state.message}`) : null,
          state.status === 'ready' && bundles.length === 0
            ? h('p', { className: 'dsh-offline-meta' }, t('empty'))
            : null,
          h('div', { className: 'dsh-offline-list' },
            bundles.map((bundle) => h(BundleRow, { key: bundle.name, bundle }))),
          h('hr', { className: 'dsh-offline-sep' }),
          h(ImportSection, { onImported: load, openPackage }));
      }

      return { DetailExportAction, OfflineTab };
    }

    /** Required services: the slot registry; locale, folder picker and page slots stay optional. */
    const inject = ['slots'];

    /**
     * Install the dictionaries and the two Plugins-page seats once the slots exist.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const ui = createUi(ctx);
      ctx.inject(['locale'], (localeCtx) => {
        localeCtx.effect(() => {
          const locale = localeCtx.locale;
          const disposers = [locale.register(NS, 'en', MESSAGES.en), locale.register(NS, 'zh', MESSAGES.zh)];
          return () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch {
                // Unloading order is owned by the runtime.
              }
            }
          };
        }, 'dsh-plugin-offline: dictionaries');
      });

      ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
        name: 'plugins.detail.actions',
        id: 'dsh-offline-export',
        order: 10,
        label: () => translateStatic(ctx, 'export'),
      }, ui.DetailExportAction));

      ctx.slots.inject('plugins.tab', () => ctx.slots.register({
        name: 'plugins.tab',
        id: 'dsh-offline-export-tab',
        order: 30,
        label: () => translateStatic(ctx, 'tabLabel'),
      }, ui.OfflineTab));
    }

    return { inject, apply, __internals: { applicationNotice } };
  },
});
