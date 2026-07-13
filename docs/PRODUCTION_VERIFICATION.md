# 本番検証の運用

AORI ROOMでは、**「ビルドが通った」ことと「本番で動く」ことを別々に判定**します。検証は3段階です。

## Gate 1 — ソース検証

`source-direct-v1.2`向けのPull Requestごとに、次を自動実行します。

1. ロックファイルどおりの依存関係インストール
2. Vitestユニットテスト
3. TypeScript型検査とVite本番ビルド
4. Durable Objectを含むCloudflare Workerのローカル起動
5. HTTPとWebSocketを使った2クライアント実通信試験

実通信試験では、静的配信、部屋作成・参加、2人上限、presence、双方向の座標・モーション中継、ルミ／ミオ／セナのキャラクター同期、不正キャラクターIDの除去、吹き出しのサニタイズ、ping/pong、ゲスト再接続と`peerState`復元まで確認します。

## Gate 2 — デプロイ済みリビジョン検証

本番ビルド時に`public/release.json`を生成します。ここへアプリのバージョン、プロトコル番号、キャラクター一覧、ビルド元のGitコミットSHAを記録します。

`source-direct-v1.2`へのpush後、本番検証ジョブは次の順で公開先を自動発見します。

1. 手動実行時の一時URL
2. 任意のRepository Variable `PRODUCTION_BASE_URL`
3. GitHub Deploymentsの`environment_url`／`target_url`
4. リポジトリのHomepage
5. リポジトリ所有者名から組み立てたCloudflare Workers既定ホスト名
6. Cloudflare Pages既定ホスト名

候補はHTTPSかつ公開ホストであることを確認し、`release.json`の`service=aori-room`またはAORI ROOMのHTMLシェルが応答したものだけを採用します。管理画面、GitHubページ、localhost、プライベートIPは候補から除外します。

公開先を発見後、`release.json`が**そのpushと同じSHA**になるまで待機し、本番URLへGate 1と同じルーム／WebSocket試験を実行します。これにより、古いデプロイ先を検査して誤って成功扱いすることを防ぎます。

さらにWebKitをiPhone 13相当で起動し、`.title-screen--v2`が実際に描画されるまで待ってタイトル画面を撮影します。画像はGitHub Actionsの成果物として30日保存します。

## Gate 3 — 定期本番監視

`main`上の監視ワークフローを6時間ごとに実行します。毎回公開先を再発見し、`source-direct-v1.2`の最新SHAと本番`release.json`を比較したうえで、API、WebSocket、キャラクター同期、再接続を再試験します。手動実行時は一時的なURL指定も可能です。

## 設定方針

本番URLの手入力は必須ではありません。GitHub DeploymentsまたはCloudflareの既定公開先から自動発見できない特殊構成だけ、Repository Variableを補助指定として使用します。

- 任意の変数名: `PRODUCTION_BASE_URL`
- 値: 本番のHTTPS URL。末尾のパスは付けない
- 場所: **Settings → Secrets and variables → Actions → Variables**

Cloudflareの本番ブランチは`source-direct-v1.2`にします。Pull Requestをマージする前には`Unit, build, and local network smoke`を必須チェックにし、リリース完了の判定は`Discover and verify deployed commit`の成功まで待ちます。公開先が見つからない場合は検証を黙ってスキップせず、探索した情報とともに明示的に失敗します。

## 手動実行

ローカルWorker:

```bash
BASE_URL=http://127.0.0.1:8787 node scripts/network-smoke.mjs
```

本番URLの自動発見:

```bash
GITHUB_TOKEN=... \
GITHUB_REPOSITORY=Milluna/GPT-DE-ASOBU \
SOURCE_REF=source-direct-v1.2 \
node scripts/resolve-production-url.mjs
```

本番と特定リビジョンの照合:

```bash
BASE_URL=https://example.com \
EXPECTED_SHA=$(git rev-parse HEAD) \
WAIT_FOR_RELEASE_MS=900000 \
node scripts/network-smoke.mjs
```

いずれかのassertionに失敗すると終了コードが非0になり、一時作成したWebSocketは成功・失敗にかかわらず閉じます。
