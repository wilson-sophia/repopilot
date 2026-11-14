"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { type RegisterActionState, register } from "../actions";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    { status: "idle" }
  );

  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (state.status === "user_exists") {
      toast({ description: "该邮箱已注册，请直接登录。", type: "error" });
    } else if (state.status === "failed") {
      toast({ description: "注册失败，请稍后重试。", type: "error" });
    } else if (state.status === "invalid_data") {
      toast({
        description: "提交内容有误，请检查邮箱和密码。",
        type: "error",
      });
    } else if (state.status === "success") {
      toast({ description: "账号创建成功！", type: "success" });
      setIsSuccessful(true);
      updateSession();
      router.refresh();
    }
  }, [state.status]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        创建你的调研空间
      </h1>
      <p className="text-sm text-muted-foreground">
        用一个账号，集中保存项目资料、来源和调研报告。
      </p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        <SubmitButton isSuccessful={isSuccessful}>注册账号</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"已有账号？"}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            登录
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
