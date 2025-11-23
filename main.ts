// ポケモンSVランクバトルお知らせ収集スクリプト (JSON版)
// 実行方法: deno run --allow-net --allow-read --allow-write --unstable-kv main.ts

import { DOMParser } from "@b-fuze/deno-dom";
import "@std/dotenv/load";

const LIST_JSON_URL = "https://sv-news.pokemon.co.jp/ja/json/list.json";
const BASE_URL = "https://sv-news.pokemon.co.jp/ja";

interface NewsListItem {
  id: string;
  reg: string;
  title: string;
  kind: string;
  kindTxt: string;
  banner: string;
  isImportant: string;
  stAt: string;
  newAt: string;
  link: string;
}

interface NewsListData {
  hash: string;
  data: NewsListItem[];
}

interface RankBattleNews {
  url: string;
  title: string;
  season: number;
  regulation: string;
  fetchedAt: string;
}

class PokemonSVScraper {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  // ページが既に取得済みかチェック
  async isAlreadyFetched(url: string): Promise<boolean> {
    const result = await this.kv.get<RankBattleNews>(["news", url]);
    return result.value !== null;
  }

  // ニュースを保存
  async saveNews(news: RankBattleNews): Promise<void> {
    await this.kv.set(["news", news.url], news);
    console.log(`✓ 保存しました: ${news.title}`);
  }

  // JSONからお知らせ一覧を取得
  async fetchNewsList(): Promise<NewsListItem[]> {
    console.log(`\n📄 お知らせ一覧JSONを取得中: ${LIST_JSON_URL}`);

    try {
      const response = await fetch(LIST_JSON_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const jsonData: NewsListData = await response.json();
      console.log(`  → 合計 ${jsonData.data.length} 件のお知らせを取得`);

      return jsonData.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ お知らせ一覧の取得に失敗: ${message}`);
      return [];
    }
  }

  // ランクバトルのお知らせのみをフィルタリング
  filterRankBattleNews(newsList: NewsListItem[]): NewsListItem[] {
    // kind: "2" が「ランクバトル」
    // タイトルが「YYYY年MM月シーズン（シーズンN）開催中！」の形式
    const titlePattern = /^\d{4}年\d{1,2}月シーズン（シーズン\d+）開催中！$/;
    
    const filtered = newsList.filter((item) => {
      return item.kind === "2" && 
             item.kindTxt === "ランクバトル" && 
             titlePattern.test(item.title);
    });

    console.log(`\n🔍 フィルタリング結果: ${filtered.length}件のランクバトルシーズン告知を発見`);
    return filtered;
  }

  // シーズン番号を抽出（例: "シーズン36" → 36）
  private extractSeason(text: string): number | null {
    const seasonMatch = text.match(/シーズン(\d+)/);
    if (seasonMatch && seasonMatch[1]) {
      return parseInt(seasonMatch[1], 10);
    }
    return null;
  }

  // レギュレーションを抽出（例: "レギュレーションJ" → "J"）
  private extractRegulation(text: string): string | null {
    const regulationMatch = text.match(/レギュレーション([A-ZＡ-Ｚ])/);
    if (regulationMatch && regulationMatch[1]) {
      const letter = regulationMatch[1];
      // 全角の場合は半角に変換
      if (letter.charCodeAt(0) >= 0xFF21 && letter.charCodeAt(0) <= 0xFF3A) {
        return String.fromCharCode(letter.charCodeAt(0) - 0xFEE0);
      }
      return letter;
    }
    return null;
  }

  // 個別ページから情報を抽出
  async extractPageContent(newsItem: NewsListItem): Promise<RankBattleNews | null> {
    const url = `${BASE_URL}/${newsItem.link}`;
    console.log(`\n📖 個別ページを取得中: ${url}`);
    console.log(`  タイトル: ${newsItem.title}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc) {
        throw new Error("HTMLの解析に失敗しました");
      }

      // メインテキストを取得
      const mainTextElement = doc.querySelector("div.main-text");
      const mainText = mainTextElement?.textContent || "";

      // シーズンとレギュレーションを抽出
      const season = this.extractSeason(mainText);
      const regulation = this.extractRegulation(mainText);

      // シーズンまたはレギュレーションが取得できない場合はスキップ
      if (season === null || regulation === null) {
        console.log(`  ⏭️  スキップ（シーズンまたはレギュレーションが見つかりません）`);
        return null;
      }

      console.log(`  → シーズン: ${season}, レギュレーション: ${regulation}`);

      return {
        url,
        title: newsItem.title,
        season,
        regulation,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ 個別ページの取得に失敗: ${message}`);
      return null;
    }
  }

  // すべてのランクバトルお知らせを収集
  async scrapeAll(): Promise<void> {
    console.log("🚀 ランクバトルお知らせの収集を開始します\n");

    let newCount = 0;
    let skipCount = 0;
    let invalidCount = 0;

    // JSONから一覧を取得
    const newsList = await this.fetchNewsList();
    if (newsList.length === 0) {
      console.log("❌ お知らせ一覧の取得に失敗しました");
      return;
    }

    // ランクバトルのお知らせのみをフィルタリング
    const rankBattleNews = this.filterRankBattleNews(newsList);

    if (rankBattleNews.length === 0) {
      console.log("ℹ️  該当するランクバトルシーズン告知が見つかりませんでした");
      return;
    }

    // 各お知らせを処理
    for (const newsItem of rankBattleNews) {
      const url = `${BASE_URL}/${newsItem.link}`;

      // 既に取得済みかチェック
      if (await this.isAlreadyFetched(url)) {
        console.log(`⏭️  スキップ（取得済み）: ${newsItem.title}`);
        skipCount++;
        continue;
      }

      // 個別ページから情報を抽出
      const news = await this.extractPageContent(newsItem);
      if (news) {
        await this.saveNews(news);
        newCount++;
      } else {
        invalidCount++;
      }

      // レート制限対策: リクエスト間隔を空ける
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("\n" + "=".repeat(50));
    console.log(`✅ 収集完了`);
    console.log(`   新規取得: ${newCount}件`);
    console.log(`   スキップ（取得済み）: ${skipCount}件`);
    console.log(`   スキップ（シーズン情報なし）: ${invalidCount}件`);
    console.log("=".repeat(50));

    // シーズン→レギュレーションマップを更新
    await this.updateSeasonRegulationMap();
  }

  // 保存済みのニュース一覧を表示
  async listSavedNews(): Promise<void> {
    console.log("\n📚 保存済みのランクバトルお知らせ:\n");

    const entries = this.kv.list<RankBattleNews>({ prefix: ["news"] });
    let count = 0;

    for await (const entry of entries) {
      count++;
      const news = entry.value;
      console.log(`${count}. ${news.title}`);
      console.log(`   シーズン: ${news.season}`);
      console.log(`   レギュレーション: ${news.regulation}`);
      console.log(`   URL: ${news.url}`);
      console.log(`   取得日時: ${news.fetchedAt}\n`);
    }

    if (count === 0) {
      console.log("まだお知らせは保存されていません。");
    }
  }

  // シーズン→レギュレーションマップをKVに保存
  private async updateSeasonRegulationMap(): Promise<void> {
    const entries = this.kv.list<RankBattleNews>({ prefix: ["news"] });
    const seasonRegulationMap: { [key: number]: string } = {};

    for await (const entry of entries) {
      const news = entry.value;
      seasonRegulationMap[news.season] = news.regulation;
    }

    // シーズン番号でソート
    const sortedSeasons = Object.keys(seasonRegulationMap)
      .map(Number)
      .sort((a, b) => a - b);

    const result: { [key: number]: string } = {};
    for (const season of sortedSeasons) {
      result[season] = seasonRegulationMap[season];
    }

    // KVに保存
    await this.kv.set(["season_regulation_map"], result);
    console.log("\n✓ シーズン→レギュレーションマップを更新しました");
  }

  // シーズン番号とレギュレーションの対応をJSON形式で出力
  async outputJson(): Promise<void> {
    const result = await this.kv.get<{ [key: number]: string }>(["season_regulation_map"]);
    
    if (result.value === null) {
      console.error("シーズン→レギュレーションマップが見つかりません。先に 'scrape' を実行してください。");
      Deno.exit(1);
    }

    console.log(JSON.stringify(result.value, null, 2));
  }

  // NetlifyにJSONをアップロード
  async deployToNetlify(): Promise<void> {
    // 環境変数から設定を取得
    const siteId = Deno.env.get("NETLIFY_SITE_ID");
    const accessToken = Deno.env.get("NETLIFY_ACCESS_TOKEN");

    if (!siteId || !accessToken) {
      console.error("環境変数 NETLIFY_SITE_ID と NETLIFY_ACCESS_TOKEN を設定してください。");
      Deno.exit(1);
    }

    // シーズン→レギュレーションマップを取得
    const result = await this.kv.get<{ [key: number]: string }>(["season_regulation_map"]);
    
    if (result.value === null) {
      console.error("シーズン→レギュレーションマップが見つかりません。先に 'scrape' を実行してください。");
      Deno.exit(1);
    }

    // JSONを整形して文字列化
    const jsonString = JSON.stringify(result.value, null, 2);
    const jsonBytes = new TextEncoder().encode(jsonString);

    // SHA1ハッシュを計算
    const hashBuffer = await crypto.subtle.digest("SHA-1", jsonBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha1 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log(`\n📦 Netlifyへのデプロイを開始します`);
    console.log(`  サイトID: ${siteId}`);
    console.log(`  ファイル: map.json`);
    console.log(`  SHA1: ${sha1}`);

    // ステップ1: デプロイを作成してファイルダイジェストを送信
    const deployUrl = `https://api.netlify.com/api/v1/sites/${siteId}/deploys`;
    const deployPayload = {
      files: {
        "/map.json": sha1
      }
    };

    console.log(`\n🚀 デプロイを作成中...`);
    const deployResponse = await fetch(deployUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(deployPayload)
    });

    if (!deployResponse.ok) {
      const errorText = await deployResponse.text();
      console.error(`❌ デプロイの作成に失敗: ${deployResponse.status} ${deployResponse.statusText}`);
      console.error(errorText);
      Deno.exit(1);
    }

    const deployData = await deployResponse.json();
    const deployId = deployData.id;
    const required = deployData.required || [];

    console.log(`  ✓ デプロイID: ${deployId}`);
    console.log(`  必要なファイル: ${required.length}件`);

    // ステップ2: 必要なファイルをアップロード
    if (required.includes(sha1)) {
      console.log(`\n📤 ファイルをアップロード中...`);
      const uploadUrl = `https://api.netlify.com/api/v1/deploys/${deployId}/files/map.json`;
      
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream"
        },
        body: jsonBytes
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error(`❌ ファイルのアップロードに失敗: ${uploadResponse.status} ${uploadResponse.statusText}`);
        console.error(errorText);
        Deno.exit(1);
      }

      console.log(`  ✓ ファイルをアップロードしました`);
    } else {
      console.log(`  ℹ️  ファイルは既にアップロード済みです`);
    }

    console.log(`\n✅ デプロイが完了しました！`);
    console.log(`  デプロイURL: https://app.netlify.com/sites/${siteId}/deploys/${deployId}`);
  }
}

// メイン処理
async function main() {
  const kv = await Deno.openKv();
  const scraper = new PokemonSVScraper(kv);

  try {
    // 引数で動作を切り替え
    const command = Deno.args[0] || "scrape";

    switch (command) {
      case "scrape":
        // ランクバトルお知らせを収集
        await scraper.scrapeAll();
        break;

      case "list":
        // 保存済みのニュース一覧を表示
        await scraper.listSavedNews();
        break;

      case "json":
        // シーズン番号とレギュレーションをJSON形式で出力
        await scraper.outputJson();
        break;

      case "deploy":
        // NetlifyにJSONをデプロイ
        await scraper.deployToNetlify();
        break;

      default:
        console.log("使用方法:");
        console.log("  deno run --allow-net --allow-read --allow-write --unstable-kv main.ts scrape");
        console.log("  deno run --allow-net --allow-read --allow-write --unstable-kv main.ts list");
        console.log("  deno run --allow-net --allow-read --allow-write --unstable-kv main.ts json");
        console.log("  deno run --allow-net --allow-read --allow-write --allow-env --unstable-kv main.ts deploy");
    }
  } finally {
    kv.close();
  }
}

if (import.meta.main) {
  main();
}