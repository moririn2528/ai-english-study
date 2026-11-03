# 語学トレーニング

シャドーイング、AI との質問し合う会話、実際の会話の振り返りを、間隔反復の復習につなげる語学練習アプリです。
サーバーを持たず、ブラウザから利用者自身の OpenAI API キーで直接 OpenAI を呼び出します。学習データはブラウザの IndexedDB に保存します。

## 開発

```sh
npm ci
npm run dev    # http://127.0.0.1:5173
npm test
npm run build
```

push 前の秘密情報チェックを有効にするには、[gitleaks](https://github.com/gitleaks/gitleaks) を入れて次を実行します。

```sh
git config core.hooksPath .githooks
```

## API キーの扱い

ブラウザにキーを置くため、次の設定を前提にしています。

- この用途専用のプロジェクトで API キーを作る
- プロジェクトに支出上限を設定する
- キーに有効期限を設定する

`public/_headers` の CSP で、スクリプトの読み込み元を自サイトに、通信先を OpenAI に限定しています。

## デプロイ

配信先は Cloudflare Workers の静的アセットで、定義は `wrangler.jsonc` と `.github/workflows/ci.yml` にあります。

1. Cloudflare の API トークン（Workers Scripts の編集権限）を作成する
2. リポジトリの Actions secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する
3. リポジトリの Actions variables に `CLOUDFLARE_DEPLOY=true` を登録する

以降は `main` / `master` への push で自動デプロイされます。

## 使用モデル

| 用途 | モデル |
|---|---|
| 文章生成・Web 検索 | `gpt-6-luna` |
| 文字起こし | `gpt-transcribe` |
| 発音評価 | `gpt-audio-1.5` |
| 音声合成 | `gpt-realtime-2.1-mini`（失敗時のみ `gpt-4o-mini-tts`、2027-01-06 終了） |
