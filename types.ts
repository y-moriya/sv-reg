// ポケモンSVランクバトルお知らせ収集 - 型定義

export interface NewsListItem {
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

export interface NewsListData {
  hash: string;
  data: NewsListItem[];
}

export interface RankBattleNews {
  url: string;
  title: string;
  season: number;
  regulation: string;
  fetchedAt: string;
}
