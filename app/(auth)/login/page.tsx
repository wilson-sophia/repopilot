"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { type LoginActionState, login } from "../actions";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" }
  );

  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (state.status === "failed") {
      toast({ description: "邮箱或密码不正确，请重新输入。", type: "error" });
    } else if (state.status === "invalid_data") {
      toast({
        description: "提交内容有误，请检查邮箱和密码。",
        type: "error",
      });
    } else if (state.status === "success") {
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
        欢迎回到调研工作台
      </h1>
      <p className="text-sm text-muted-foreground">
        登录后，在不同设备上继续管理你的项目与调研记录。
      </p>
      <AuthForm action={handleSubmit} defaultEmail={email}>
        <SubmitButton isSuccessful={isSuccessful}>登录</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"还没有账号？"}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/register"
          >
            注册账号
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
