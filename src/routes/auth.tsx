import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Вход — CRM" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    db.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await db.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard", replace: true });
  };

  const [forgot, setForgot] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("reset");
    if (t) setResetToken(t);
  }, []);

  const applyNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    setLoading(true);
    const { error } = await db.auth.resetPasswordWithToken(resetToken, password);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Пароль изменён — войдите с новым паролем");
    setResetToken(null);
    setPassword("");
    window.history.replaceState(null, "", "/auth");
  };

  const resetPass = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await db.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Письмо отправлено — проверьте почту и перейдите по ссылке");
    setForgot(false);
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await db.auth.signUp({
      email, password,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Аккаунт создан");
    const { data } = await db.auth.getUser();
    if (data.user) navigate({ to: "/dashboard", replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 justify-center mb-6">
          <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">К</div>
          <span className="text-xl font-semibold">КабинетCRM</span>
        </Link>
        <Card className="p-6 shadow-lg">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="signin">Вход</TabsTrigger>
              <TabsTrigger value="signup">Регистрация</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              {forgot ? (
              <form onSubmit={resetPass} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Укажите почту, на которую зарегистрирован вход — пришлём ссылку для смены пароля.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="email-reset">Email</Label>
                  <Input id="email-reset" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Отправляем…" : "Отправить ссылку"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setForgot(false)}>
                  Назад к входу
                </Button>
              </form>
              ) : (
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Входим…" : "Войти"}
                </Button>
                <button type="button" onClick={() => setForgot(true)} className="w-full text-sm text-primary hover:underline">
                  Забыли пароль?
                </button>
              </form>
              )}
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email2">Email</Label>
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">Пароль</Label>
                  <Input id="password2" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Создаём…" : "Создать аккаунт"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
