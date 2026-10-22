import type { Metadata } from "next";
import { ResearchWorkspace } from "@/components/research";

export const metadata: Metadata = {
  description: "连接开源仓库与项目文档，用可追溯的证据完成技术调研。",
  title: "RepoPilot · 研发调研工作台",
};

export default function ResearchPage() {
  return <ResearchWorkspace />;
}
