import {
  ArrowLeft,
  BookOpen,
  FileSearch,
  History,
  Layers3,
} from "lucide-react";
import Link from "next/link";
import "./auth.css";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <Link className="auth-brand" href="/research">
          <Layers3 /> RepoPilot <span>开源项目调研工作台</span>
        </Link>
        <div className="auth-story">
          <p className="auth-kicker">从资料到判断，每一步都有依据</p>
          <h2>
            把开源选型的线索，
            <br />
            整理成有据可查的结论。
          </h2>
          <p>
            围绕真实需求，检索项目资料、核对仓库动态，留下一份可以回查来源的调研记录。
          </p>
          <div className="auth-features">
            <article>
              <FileSearch />
              <div>
                <h3>围绕项目展开调研</h3>
                <p>将需求、仓库和问题集中到同一个空间。</p>
              </div>
            </article>
            <article>
              <BookOpen />
              <div>
                <h3>让结论关联原文</h3>
                <p>导入资料，查看引用，核对每一条证据。</p>
              </div>
            </article>
            <article>
              <History />
              <div>
                <h3>保留每一次探索</h3>
                <p>回看历史记录，导出报告，继续深入分析。</p>
              </div>
            </article>
          </div>
        </div>
        <p className="auth-footnote">有来源的分析，让技术决策更清晰。</p>
      </section>
      <section className="auth-entry">
        <Link className="auth-back" href="/research">
          <ArrowLeft size={16} /> 返回工作台
        </Link>
        <div className="auth-card">
          <div className="auth-mark">
            <Layers3 />
          </div>
          {children}
          <p className="auth-privacy">账号用于保存和访问你的个人调研空间。</p>
        </div>
      </section>
    </main>
  );
}
