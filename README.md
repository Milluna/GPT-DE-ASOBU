# AORI ROOM — iPhone Safari向け2人用3Dコミュニケーション試作

白猫テニスの**キャラクター資産やUIをコピーせず**、次の操作体験だけを独自実装した最初のプレイアブル・プロトタイプです。

- 画面上の任意位置から始まるフローティングスティック
- 自由移動、円を描く入力による「サンドリ」判定
- 左右の入力反転ごとに踏み出しモーションを先頭から再発火
- 5桁ルーム番号による2人入室
- 3タブ × 6択の定型メッセージと頭上吹き出し
- iPhoneの画面ロック・タブ復帰後を想定したWebSocket再接続
- タイトル画面から18メッセージを編集し、端末内に保存

![タイトル](docs/screenshots/title.png)

<p align="center">
  <img src="docs/screenshots/bubble.png" width="260" alt="吹き出し表示">
  <img src="docs/screenshots/messages.png" width="260" alt="3タブ6択メッセージUI">
</p>

## 現在の到達点

この版は、**操作・同期・画面構成を先に検証する第1プロトタイプ**です。キャラクターは、約3頭身のシルエット、トゥーン陰影、生成した顔・服テクスチャを持つ完全オリジナルのプロシージャル仮アバターです。

最終版で求める「商用ゲーム級の美麗キャラクター」そのものではありません。次段階では、専用制作したGLBモデル、リグ、表情、髪・衣装揺れ、KTX2圧縮テクスチャへ差し替える前提です。ゲームロジックとルーム通信は、その差し替えを妨げない構造に分離しています。

## 技術構成

```text
Vite + TypeScript + Three.js
        │
        ├─ 3D描画・仮アバター・移動制御
        ├─ HTML/CSSのスマホUI
        └─ WebSocketクライアント
                 │
Cloudflare Worker + Durable Object
        ├─ 5桁ルーム作成／参加
        ├─ 最大2人のセッション管理
        ├─ 位置・向き・モーション通し番号の中継
        ├─ 吹き出しイベント中継
        └─ 30分後の自動失効
```

ルームごとに1つのDurable Objectを使い、WebSocket Hibernation APIで接続を管理します。静的ファイル、API、WebSocketを1つのWorkerプロジェクトから配信します。

## ローカルで動かす

Node.js 22以降を使用します。

```bash
npm install
npm run dev:full
```

起動後、ブラウザで次を開きます。

```text
http://localhost:8787
```

`dev:full`は本番ビルド後にローカルWorkerを起動する簡単な確認用です。フロントエンドをHMR付きで編集する場合は、別々のターミナルで実行します。

```bash
# Terminal 1: API / WebSocket
npm run dev:worker

# Terminal 2: Vite（/api と /ws を8787へプロキシ）
npm run dev
```

## iPhoneで同一LAN確認

PCとiPhoneを同じWi-Fiへ接続し、Wranglerが表示するLAN内URLをSafariで開きます。HTTPでは一部のブラウザ機能に制限があるため、最終的な実機確認はCloudflareへデプロイしたHTTPS URLで行うのが確実です。

1台目で「部屋をつくる」を選び、表示された5桁番号を共有します。2台目で「部屋に入る」から同じ番号を入力します。

## Cloudflareへ公開

Cloudflareアカウントで初回認証後、1コマンドでビルドとデプロイを実行できます。

```bash
npx wrangler login
npm run deploy
```

`wrangler.jsonc`には、Static Assets、SPAフォールバック、Durable Object、SQLiteクラスの初回マイグレーションが設定済みです。独自ドメインはCloudflareのダッシュボードまたはWrangler設定から後付けできます。

## テスト

```bash
npm run check
```

現時点の自動テストは次を確認します。

- 加速、移動、減速
- 左右反転による開始モーション再発火
- 円運動入力によるサンドリ判定
- ステージ境界
- 相手座標の補間
- 同一モーション通し番号の即時反映

ローカルWorker起動中は、2本のWebSocketを実際に接続してルーム同期を検証できます。

```bash
npm run smoke:network
```

このスモークテストは、部屋作成、参加、presence、座標／モーション中継、吹き出し中継を検証します。

## 調整箇所

### 移動感

`src/game/locomotion.ts` の `DEFAULT_LOCOMOTION_TUNING` で調整します。

```ts
maxSpeed
acceleration
deceleration
turnSharpness
startDuration
startRetriggerCooldownMs
sandoriAngularVelocity
sandoriHoldSeconds
```

左右反転がクールダウン内に入っても入力を捨てず、最初の有効フレームで反対側モーションを再発火する実装になっています。

### 仮アバター

`src/game/avatar.ts` にあります。現在は外部アセット不要のプロシージャルモデルです。最終モデルへの差し替え時は、次を追加する想定です。

- `GLTFLoader`によるGLB読込
- idle / run / start-left / start-right / sandori のAnimationClip
- 表情用BlendShape
- 髪・スカートの軽量スプリング
- KTX2テクスチャ
- 端末性能別LOD

### 定型メッセージ

`src/settings/messageStore.ts` に初期18文があります。ユーザー編集値はブラウザの`localStorage`へ保存されます。通信時にもサーバー側で40文字、制御文字除去、100ms間隔の制限をかけています。

## 現在の制約と次の作業

- 参考動画の数値を直接取得したものではなく、移動カーブは初期近似です。実機動画と並べて加速、旋回半径、切り返し間隔を詰める必要があります。
- 実機iPhone Safariでの長時間発熱、メモリ、低電力モード、着信・画面ロック復帰は未計測です。
- 5桁番号は秘密情報ではありません。公開規模を広げる前に、参加試行のIPレート制限やホスト承認を追加します。
- 現在のアバターは仮素材です。美麗な最終キャラクターには専用モデリング／テクスチャ／モーション制作が必要です。
- 音、表情、カメラ演出、参加時演出は未実装です。

## 権利方針

キャラクター、名称、UI、背景、テクスチャ、モーション、メッセージ文はオリジナルで制作します。既存ゲームのモデル・テクスチャ・効果音・コードは含めません。

## Direct-source deployment

The deployable TypeScript source lives directly at the repository root on this branch. Cloudflare uses `npm run build` and `npm run deploy`. The build runs unit tests and TypeScript checks before creating `dist/`.

## v1.3 animation behavior

- Racket wind-up now travels behind the avatar and strikes toward its visible front.
- Run and sandori use fixed-rate leg loops driven by input motion, not realized displacement.
- Sandori remains active while circling the stick into the center net or stage boundary.
## v2.0 キャラクター選択と同期アバター

- タイトル画面を全面刷新し、ルミ／ミオ／セナの3人から選んで入室できるようにしました。
- 選択キャラクターは端末内へ保存され、部屋作成・番号入室・操作テストのすべてへ引き継がれます。
- キャラクターIDを位置・モーション状態と一緒にWebSocket同期し、相手側の3Dアバターと参加者表示にも反映します。
- 3人は配色だけでなく、サイドポニー／ボブ／ツインテールのシルエット差を持つ完全オリジナルのプロシージャルアバターです。
- 同じキャラクター同士でもホスト／ゲストの足元リングで判別できます。

このv2.0では、外部の既存ゲーム資産を使用せず、タイトル用の高密度CSSアートとThree.jsの軽量トゥーンモデルを同じキャラクター定義から生成します。将来GLBへ差し替える場合も、キャラクターIDと通信プロトコルはそのまま利用できます。

