// ============================================================
// 线上多人对战配置
// ------------------------------------------------------------
// 留空 = 只用「本地联机」模式（同一浏览器的多个窗口/标签页互连，
//        适合开发调试和同机演示，不需要任何后端）。
//
// 下面填的是 Supabase 项目的公开信息，可以安全地放进前端代码：
//   Project URL          —— https://<项目ref>.supabase.co
//   Publishable key      —— sb_publishable_...（旧项目是 anon 的 JWT key，等价）
//
// 千万不要把 SECRET key（sb_secret_...）或 service_role key 填进来。
// ============================================================

export const SUPABASE_URL = 'https://qvzgvyyydeovcuxixzro.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_VW-SRwvWyOC_5fD5ps0epA_g-MOXCfF';
