# 語学トレーニング

シャドーイング、AI との質問し合う会話、実際の会話の振り返りを、間隔反復の復習につなげる語学練習アプリです。
OpenAI へは Cloudflare Worker（`worker/index.ts`）経由で通信し、API キーは Worker の Secret としてサーバー側にだけ置きます。学習データはブラウザの IndexedDB に保存します。

## 開発

```sh
npm ci
npm run dev      # http://127.0.0.1:5173
npm run dev:api  # 中継 Worker（別ターミナル。/api を 8787 に転送）
npm test
npm run build
```

push 前の秘密情報チェックを有効にするには、[gitleaks](https://github.com/gitleaks/gitleaks) を入れて次を実行します。

```sh
git config core.hooksPath .githooks
```

`npm run dev:api` の前に、`.dev.vars`（git 管理外）を作ります。`ALLOW_UNAUTHENTICATED` はループバック（127.0.0.1 / localhost）でだけ有効です。

```sh
printf 'OPENAI_API_KEY=sk-...\nALLOW_UNAUTHENTICATED=true\n' > .dev.vars
npm run build   # wrangler dev は dist/ を必要とします
```

## API キーの扱い

- キーは Worker の Secret `OPENAI_API_KEY` に保存し、ブラウザには一度も渡しません。
- ブラウザは同一オリジンの `/api/openai/*` を呼び、Worker がキーを付けて OpenAI に転送します。転送するのはアプリが使うエンドポイントだけです。
- Worker は Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion`）を自分でも検証し、Access 設定が欠けていれば転送しません（fail closed）。
- 音声合成の Realtime 接続には、Worker で発行した短命の一時キーだけを使います。
- キーは 1 本を共有するので、`allowed_emails` の全員の利用が同じ請求になります。専用プロジェクトのキーにして、支出上限と有効期限を設定してください。

`public/_headers` の CSP で、スクリプトの読み込み元を自サイトに、通信先を自サイトと OpenAI Realtime（`wss://api.openai.com`）に限定しています。

## デプロイ

配信先は Cloudflare Workers で、定義は `wrangler.jsonc` と `.github/workflows/deploy.yml` にあります。
PR では `ci.yml` がテストとビルドを、`main` にマージ（push）すると `deploy.yml` がテスト・ビルド・デプロイを行います。
Actions の画面から手動で実行（workflow_dispatch）することもできます。

1. Cloudflare の API トークンを「Edit Cloudflare Workers」テンプレートで作成する
2. リポジトリの Actions secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する

```sh
gh secret set CLOUDFLARE_API_TOKEN      # 貼り付けて Enter
gh secret set CLOUDFLARE_ACCOUNT_ID
```

secrets が無いと、デプロイは最初のステップで失敗し、足りない名前を表示します。

初回だけ、Worker の Secret を登録します（Secret はデプロイしても消えません）。

```sh
npx wrangler secret put OPENAI_API_KEY
cd infra && terraform apply   # Access アプリ作成後に出力が得られます
echo '<team>.cloudflareaccess.com' | npx wrangler secret put ACCESS_TEAM_DOMAIN  # ログイン画面の URL のホスト名
terraform output -raw access_aud | npx wrangler secret put ACCESS_AUD
```

3 つが揃うまで、`/api` は 401 を返します。

## 使用モデル

| 用途 | モデル |
|---|---|
| 文章生成・Web 検索 | `gpt-6-luna` |
| 文字起こし | `gpt-transcribe` |
| 発音評価 | `gpt-audio-1.5` |
| 音声合成 | `gpt-realtime-2.1-mini`（失敗時のみ `gpt-4o-mini-tts`、2027-01-06 終了） |
