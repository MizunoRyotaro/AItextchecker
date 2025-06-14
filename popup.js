// AI文章チェッカー & プロンプト変換 - ポップアップ設定画面
class SettingsManager {
  constructor() {
    this.elements = {};
    this.currentMode = 'text-check';
    this.init();
  }

  async init() {
    this.setupElements();
    this.setupEventListeners();
    await this.loadSettings();
    await this.loadStats();
  }

  setupElements() {
    this.elements = {
      enabledToggle: document.getElementById('enabledToggle'),
      apiKey: document.getElementById('apiKey'),
      minLength: document.getElementById('minLength'),
      learningToggle: document.getElementById('learningToggle'),
      promptStyle: document.getElementById('promptStyle'),
      promptLength: document.getElementById('promptLength'),
      saveButton: document.getElementById('saveButton'),
      statusMessage: document.getElementById('statusMessage'),
      todayChecks: document.getElementById('todayChecks'),
      totalChecks: document.getElementById('totalChecks'),
      totalIssues: document.getElementById('totalIssues'),
      modeDescription: document.getElementById('modeDescription'),
      textCheckSettings: document.getElementById('textCheckSettings'),
      promptSettings: document.getElementById('promptSettings')
    };
  }

  setupEventListeners() {
    // モードタブの切り替え
    const modeTabs = document.querySelectorAll('.mode-tab');
    modeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.getAttribute('data-mode');
        this.switchMode(mode);
      });
    });

    // 有効/無効トグル
    this.elements.enabledToggle.addEventListener('click', () => {
      this.elements.enabledToggle.classList.toggle('active');
    });

    // 英語学習機能トグル
    this.elements.learningToggle.addEventListener('click', () => {
      this.elements.learningToggle.classList.toggle('active');
    });

    // 保存ボタン
    this.elements.saveButton.addEventListener('click', () => {
      this.saveSettings();
    });

    // Enter キーで保存
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.saveSettings();
      }
    });

    // 入力フィールドの変更を監視
    [this.elements.apiKey, this.elements.minLength, this.elements.promptStyle, this.elements.promptLength].forEach(input => {
      input.addEventListener('input', () => {
        this.hideStatusMessage();
      });
    });

    // APIキー入力時の表示切り替え
    this.elements.apiKey.addEventListener('focus', () => {
      this.elements.apiKey.type = 'text';
    });

    this.elements.apiKey.addEventListener('blur', () => {
      this.elements.apiKey.type = 'password';
    });
  }

  switchMode(mode) {
    this.currentMode = mode;
    
    // タブの状態を更新
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.classList.remove('active');
      if (tab.getAttribute('data-mode') === mode) {
        tab.classList.add('active');
      }
    });

    // 設定パネルの表示切り替え
    this.elements.textCheckSettings.classList.remove('active');
    this.elements.promptSettings.classList.remove('active');
    
    if (mode === 'text-check') {
      this.elements.textCheckSettings.classList.add('active');
      this.elements.modeDescription.textContent = '日本語文章の誤字脱字や表現をAIがチェックします';
    } else if (mode === 'prompt-convert') {
      this.elements.promptSettings.classList.add('active');
      this.elements.modeDescription.textContent = '日本語でイメージを記述し、最新Midjourney（v6.1対応）WEB版用の英語プロンプトに変換します';
    }
  }

  async loadSettings() {
    try {
      const settings = await this.getStorageData([
        'enabled', 'apiKey', 'minLength', 'mode', 
        'learningEnabled', 'promptStyle', 'promptLength'
      ]);
      
      // デフォルト値の設定
      const defaults = {
        enabled: true,
        apiKey: '',
        minLength: 20,
        mode: 'text-check',
        learningEnabled: true,
        promptStyle: 'none',
        promptLength: 'medium'
      };

      // モードを設定
      const mode = settings.mode || defaults.mode;
      this.switchMode(mode);

      // UIに反映
      const enabled = settings.enabled !== false;
      if (enabled) {
        this.elements.enabledToggle.classList.add('active');
      }

      const learningEnabled = settings.learningEnabled !== false;
      if (learningEnabled) {
        this.elements.learningToggle.classList.add('active');
      }

      this.elements.apiKey.value = settings.apiKey || defaults.apiKey;
      this.elements.minLength.value = settings.minLength || defaults.minLength;
      this.elements.promptStyle.value = settings.promptStyle || defaults.promptStyle;
      this.elements.promptLength.value = settings.promptLength || defaults.promptLength;

    } catch (error) {
      console.error('設定の読み込みエラー:', error);
      this.showStatusMessage('設定の読み込みに失敗しました', 'error');
    }
  }

  async loadStats() {
    try {
      const stats = await this.getStorageData(['todayChecks', 'totalChecks', 'totalIssues', 'lastStatsDate']);
      
      const today = new Date().toDateString();
      const lastStatsDate = stats.lastStatsDate;

      // 日付が変わった場合は今日のカウントをリセット
      let todayChecks = stats.todayChecks || 0;
      if (lastStatsDate !== today) {
        todayChecks = 0;
      }

      this.elements.todayChecks.textContent = todayChecks;
      this.elements.totalChecks.textContent = stats.totalChecks || 0;
      this.elements.totalIssues.textContent = stats.totalIssues || 0;

    } catch (error) {
      console.error('統計の読み込みエラー:', error);
    }
  }

  async saveSettings() {
    try {
      this.elements.saveButton.disabled = true;
      this.elements.saveButton.textContent = '保存中...';

      const settings = {
        enabled: this.elements.enabledToggle.classList.contains('active'),
        apiKey: this.elements.apiKey.value.trim(),
        minLength: parseInt(this.elements.minLength.value),
        mode: this.currentMode,
        learningEnabled: this.elements.learningToggle.classList.contains('active'),
        promptStyle: this.elements.promptStyle.value,
        promptLength: this.elements.promptLength.value
      };

      // バリデーション
      const validation = this.validateSettings(settings);
      if (!validation.isValid) {
        this.showStatusMessage(validation.message, 'error');
        return;
      }

      // APIキーのテスト（空でない場合）
      if (settings.apiKey) {
        const isApiValid = await this.testApiKey(settings.apiKey);
        if (!isApiValid) {
          this.showStatusMessage('APIキーが無効です。確認してください', 'error');
          return;
        }
      }

      // 設定を保存
      await this.setStorageData(settings);
      
      // コンテンツスクリプトに設定変更を通知
      await this.notifyContentScript();

      this.showStatusMessage('設定を保存しました', 'success');

    } catch (error) {
      console.error('設定の保存エラー:', error);
      this.showStatusMessage('設定の保存に失敗しました', 'error');
    } finally {
      this.elements.saveButton.disabled = false;
      this.elements.saveButton.textContent = '設定を保存';
    }
  }

  validateSettings(settings) {
    if (settings.minLength < 10 || settings.minLength > 1000) {
      return { isValid: false, message: '最小チェック文字数は10-1000の範囲で設定してください' };
    }

    if (settings.enabled && !settings.apiKey) {
      return { isValid: false, message: '機能を有効にするにはAPIキーが必要です' };
    }

    return { isValid: true };
  }

  async testApiKey(apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'テスト'
            }]
          }],
          generationConfig: {
            maxOutputTokens: 10
          }
        })
      });

      return response.ok;
    } catch (error) {
      console.error('APIキーテストエラー:', error);
      return false;
    }
  }

  async notifyContentScript() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SETTINGS_UPDATED'
        });
      }
    } catch (error) {
      console.log('Content script notification failed:', error);
    }
  }

  showStatusMessage(message, type) {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type}`;
    this.elements.statusMessage.style.display = 'block';

    // 成功メッセージは3秒後に自動で隠す
    if (type === 'success') {
      setTimeout(() => {
        this.hideStatusMessage();
      }, 3000);
    }
  }

  hideStatusMessage() {
    this.elements.statusMessage.style.display = 'none';
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
}

// ページ読み込み完了時に初期化
document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});

// 統計更新のメッセージリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STATS_UPDATED') {
    // 統計を再読み込み
    const settingsManager = new SettingsManager();
    settingsManager.loadStats();
  }
}); 