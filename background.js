// AI文章チェッカー & プロンプト変換 - バックグラウンドサービスワーカー
class BackgroundService {
  constructor() {
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.initializeStats();
    // コンテキストメニューの作成は少し遅延させる
    setTimeout(() => {
      this.createContextMenu();
    }, 100);
  }

  setupEventListeners() {
    // インストール時の初期化
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });

    // 起動時の初期化
    chrome.runtime.onStartup.addListener(() => {
      setTimeout(() => {
        this.createContextMenu();
      }, 500);
    });

    // コンテンツスクリプトからのメッセージ処理
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 非同期レスポンスを有効化
    });

    // ストレージ変更の監視
    chrome.storage.onChanged.addListener((changes, namespace) => {
      this.handleStorageChange(changes, namespace);
    });

    // コンテキストメニューのクリック処理
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      this.handleContextMenuClick(info, tab);
    });
  }

  async createContextMenu() {
    try {
      // 既存のメニューを削除
      await new Promise((resolve) => {
        chrome.contextMenus.removeAll(() => {
          if (chrome.runtime.lastError) {
            console.log('Context menu removal:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      });

      const settings = await this.getStorageData(['enabled', 'mode']);
      
      if (settings.enabled !== false) {
        const currentMode = settings.mode || 'text-check';
        
        if (currentMode === 'text-check') {
          // 誤字脱字チェック用メニュー
          chrome.contextMenus.create({
            id: 'aiTextChecker',
            title: '🔍 誤字脱字をチェック',
            contexts: ['selection'],
            documentUrlPatterns: ['http://*/*', 'https://*/*'],
            targetUrlPatterns: ['http://*/*', 'https://*/*']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('Context menu creation error:', chrome.runtime.lastError.message);
            } else {
              console.log('Text checker context menu created successfully');
            }
          });
        } else if (currentMode === 'prompt-convert') {
          // Midjourneyプロンプト変換用メニュー
          chrome.contextMenus.create({
            id: 'midjourneyPrompt',
            title: '🎨 MidjourneyWEBプロンプトに変換',
            contexts: ['selection'],
            documentUrlPatterns: ['http://*/*', 'https://*/*'],
            targetUrlPatterns: ['http://*/*', 'https://*/*']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('Context menu creation error:', chrome.runtime.lastError.message);
            } else {
              console.log('Midjourney prompt context menu created successfully');
            }
          });
        }
      }
    } catch (error) {
      console.error('Error in createContextMenu:', error);
    }
  }

  async handleContextMenuClick(info, tab) {
    if (info.menuItemId === 'aiTextChecker' || info.menuItemId === 'midjourneyPrompt') {
      try {
        console.log('Context menu clicked, selection info:', info.selectionText);
        
        // まず選択テキストを確認
        const minLength = info.menuItemId === 'midjourneyPrompt' ? 5 : 10; // プロンプト変換は短めでもOK
        if (!info.selectionText || info.selectionText.trim().length < minLength) {
          const message = info.selectionText 
            ? `選択されたテキストが短すぎます（${info.selectionText.trim().length}文字）。${minLength}文字以上選択してください。`
            : `${minLength}文字以上のテキストを選択してから右クリックしてください。`;
          this.showNotification('選択エラー', message);
          return;
        }

        // まず、コンテンツスクリプトが注入されているかチェック
        await this.ensureContentScriptInjected(tab);

        // 選択テキストをコンテンツスクリプトに渡して処理実行
        const action = info.menuItemId === 'aiTextChecker' ? 'checkSelectedText' : 'convertToPrompt';
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: action,
          selectedText: info.selectionText.trim()
        });

        if (!response || !response.success) {
          // エラー時の処理
          console.error('Processing failed:', response?.error || 'Unknown error');
          this.showNotification('エラー', response?.error || '処理に失敗しました');
        } else {
          console.log('Processing completed successfully');
        }
      } catch (error) {
        console.error('Context menu action failed:', error);
        
        // より具体的なエラーメッセージ
        let errorMessage = '処理に失敗しました。';
        if (error.message.includes('Could not establish connection')) {
          errorMessage = 'このページではご利用いただけません。通常のWebページで再試行してください。';
        } else if (error.message.includes('Extension context invalidated')) {
          errorMessage = '拡張機能を再読み込みしてください。';
        } else if (error.message.includes('Cannot access a chrome')) {
          errorMessage = 'Chromeの特殊ページでは利用できません。通常のWebページでお試しください。';
        } else if (error.message.includes('Tabs cannot be edited')) {
          errorMessage = 'このページは編集できません。';
        }
        
        this.showNotification('エラー', errorMessage);
      }
    }
  }

  async ensureContentScriptInjected(tab) {
    try {
      console.log('Checking tab:', tab.url, 'Window type:', tab.windowId);
      
      // ウィンドウの詳細情報を取得
      let windowInfo = null;
      try {
        windowInfo = await chrome.windows.get(tab.windowId);
        console.log('Window info:', windowInfo.type, windowInfo.state);
      } catch (windowError) {
        console.log('Could not get window info:', windowError.message);
      }
      
      // タブのURLをチェック
      if (!tab.url || 
          tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('moz-extension://') ||
          tab.url.startsWith('about:') ||
          tab.url.startsWith('file://') ||
          tab.url.startsWith('edge://') ||
          tab.url.startsWith('opera://')) {
        throw new Error('このページでは利用できません');
      }

      // ページの読み込み状態をチェック（ポップアップは特に重要）
      if (tab.status !== 'complete') {
        console.log('Page not fully loaded, waiting...');
        // ページの読み込み完了を待つ
        await new Promise(resolve => {
          const checkLoading = setInterval(async () => {
            try {
              const updatedTab = await chrome.tabs.get(tab.id);
              if (updatedTab.status === 'complete') {
                clearInterval(checkLoading);
                resolve();
              }
            } catch (error) {
              clearInterval(checkLoading);
              resolve(); // タブが閉じられた場合など
            }
          }, 100);
          
          // ポップアップの場合は少し長めに待つ
          const timeout = windowInfo?.type === 'popup' ? 10000 : 5000;
          setTimeout(() => {
            clearInterval(checkLoading);
            resolve();
          }, timeout);
        });
      }

      // コンテンツスクリプトが既に注入されているかテスト
      try {
        console.log('Testing existing content script...');
        const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        console.log('Content script already injected:', pingResponse);
        return; // 既に注入済み
      } catch (pingError) {
        console.log('Content script not found, attempting injection...', pingError.message);
      }

      // ポップアップウィンドウの場合は少し待ってから注入
      if (windowInfo?.type === 'popup') {
        console.log('Popup window detected, waiting before injection...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // コンテンツスクリプトを手動で注入
      console.log('Injecting content script...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      // CSS も注入
      console.log('Injecting CSS...');
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles.css']
      });

      // 注入後に少し待つ（ポップアップは長めに）
      const injectionDelay = windowInfo?.type === 'popup' ? 800 : 300;
      await new Promise(resolve => setTimeout(resolve, injectionDelay));
      
      // 再度ping確認
      try {
        const finalPing = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        console.log('Content script injection verified:', finalPing);
      } catch (verifyError) {
        console.warn('Content script verification failed, but continuing:', verifyError.message);
        
        // ポップアップの場合はもう一回試す
        if (windowInfo?.type === 'popup') {
          console.log('Retrying injection for popup window...');
          await new Promise(resolve => setTimeout(resolve, 500));
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            const retryPing = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
            console.log('Popup injection retry successful:', retryPing);
          } catch (retryError) {
            console.warn('Popup injection retry failed:', retryError.message);
          }
        }
      }

    } catch (error) {
      console.error('Failed to inject content script:', error);
      
      if (error.message.includes('Cannot access a chrome') || error.message.includes('Cannot access contents of')) {
        throw new Error('Chromeの特殊ページでは利用できません。通常のWebページでお試しください。');
      } else if (error.message.includes('このページでは利用できません')) {
        throw new Error('このページでは利用できません');
      } else if (error.message.includes('The tab was closed')) {
        throw new Error('タブが閉じられました');
      } else {
        throw new Error(`このページではご利用いただけません: ${error.message}`);
      }
    }
  }

  showNotification(title, message) {
    // 通知を表示（オプション機能）
    try {
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjQiIGZpbGw9IiMwMDdiZmYiLz4KPHN2ZyB4PSIxMiIgeT0iMTIiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIj4KPHA+dGV4dDwvdGV4dD4KPHN2Zz4KPC9zdmc+', // シンプルなアイコン
          title: title,
          message: message
        });
      }
    } catch (error) {
      console.log('Notification error:', error);
    }
  }

  async handleInstall(details) {
    console.log('AI文章チェッカーがインストールされました:', details.reason);

    if (details.reason === 'install') {
      // 初回インストール時のデフォルト設定
      await this.setDefaultSettings();
      
      // コンテキストメニューを作成（少し遅延）
      setTimeout(() => {
        this.createContextMenu();
      }, 1000);
    } else if (details.reason === 'update') {
      // アップデート時もコンテキストメニューを再作成
      setTimeout(() => {
        this.createContextMenu();
      }, 500);
    }
  }

  async setDefaultSettings() {
    const defaultSettings = {
      enabled: true,
      apiKey: '',
      minLength: 10,
      mode: 'text-check',
      learningEnabled: true,
      promptStyle: 'detailed',
      promptLength: 'medium',
      todayChecks: 0,
      totalChecks: 0,
      totalIssues: 0,
      lastStatsDate: new Date().toDateString()
    };

    // 既存の設定がない場合のみデフォルトを設定
    const existingSettings = await this.getStorageData(Object.keys(defaultSettings));
    const settingsToSet = {};

    for (const [key, defaultValue] of Object.entries(defaultSettings)) {
      if (existingSettings[key] === undefined) {
        settingsToSet[key] = defaultValue;
      }
    }

    if (Object.keys(settingsToSet).length > 0) {
      await this.setStorageData(settingsToSet);
      console.log('デフォルト設定を適用しました:', settingsToSet);
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'UPDATE_STATS':
          await this.updateStats(message.data);
          sendResponse({ success: true });
          break;

        case 'GET_SETTINGS':
          const settings = await this.getStorageData([
            'enabled', 'apiKey', 'minLength', 'mode', 
            'learningEnabled', 'promptStyle', 'promptLength'
          ]);
          sendResponse({ success: true, data: settings });
          break;

        case 'CHECK_TEXT':
        case 'CONVERT_PROMPT':
          // 将来的にバックグラウンドでAI処理を実行する場合
          const result = await this.performAITask(message.data, message.type);
          sendResponse({ success: true, data: result });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('メッセージ処理エラー:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async updateStats(data) {
    const today = new Date().toDateString();
    const stats = await this.getStorageData(['todayChecks', 'totalChecks', 'totalIssues', 'lastStatsDate']);

    let todayChecks = stats.todayChecks || 0;
    let totalChecks = stats.totalChecks || 0;
    let totalIssues = stats.totalIssues || 0;

    // 日付が変わった場合は今日のカウントをリセット
    if (stats.lastStatsDate !== today) {
      todayChecks = 0;
    }

    // 統計を更新
    if (data.type === 'check_completed' || data.type === 'prompt_converted') {
      todayChecks++;
      totalChecks++;
      
      if (data.issuesFound) {
        totalIssues += data.issuesFound;
      }
    }

    const updatedStats = {
      todayChecks,
      totalChecks,
      totalIssues,
      lastStatsDate: today
    };

    await this.setStorageData(updatedStats);

    // ポップアップに統計更新を通知
    this.notifyPopup('STATS_UPDATED', updatedStats);
  }

  async initializeStats() {
    // 起動時に統計を初期化
    const today = new Date().toDateString();
    const stats = await this.getStorageData(['lastStatsDate', 'todayChecks']);

    // 日付が変わっていた場合、今日のチェック数をリセット
    if (stats.lastStatsDate !== today) {
      await this.setStorageData({
        todayChecks: 0,
        lastStatsDate: today
      });
    }
  }

  async handleStorageChange(changes, namespace) {
    if (namespace === 'sync') {
      // 設定変更をコンテンツスクリプトに通知
      if (changes.enabled || changes.apiKey || changes.minLength || changes.mode || 
          changes.learningEnabled || changes.promptStyle || changes.promptLength) {
        this.notifyAllTabs('SETTINGS_CHANGED', changes);
        
        // 有効/無効設定やモードが変更された場合はコンテキストメニューを更新
        if (changes.enabled || changes.mode) {
          setTimeout(() => {
            this.createContextMenu();
          }, 100);
        }
      }
    }
  }

  async notifyAllTabs(type, data) {
    try {
      const tabs = await chrome.tabs.query({});
      
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type, data });
        } catch (error) {
          // タブにコンテンツスクリプトが読み込まれていない場合は無視
        }
      }
    } catch (error) {
      console.error('タブ通知エラー:', error);
    }
  }

  async notifyPopup(type, data) {
    try {
      // ポップアップが開いている場合に通知
      await chrome.runtime.sendMessage({ type, data });
    } catch (error) {
      // ポップアップが開いていない場合は無視
    }
  }

  async performAITask(data, taskType) {
    // 将来的にバックグラウンドでAI処理を実行する場合の実装
    // 現在はコンテンツスクリプトで直接API呼び出しを行っているため、未実装
    throw new Error(`Background ${taskType} not implemented`);
  }

  async getStorageData(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, resolve);
    });
  }

  async setStorageData(data) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, resolve);
    });
  }

  // デバッグ用のログ出力
  log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] AI文章チェッカー: ${message}`, data);
  }
}

// サービスワーカー初期化
const backgroundService = new BackgroundService();

// グローバルエラーハンドリング
self.addEventListener('error', (event) => {
  console.error('Background service error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});