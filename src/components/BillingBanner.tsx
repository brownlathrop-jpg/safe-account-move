// Полоска сверху: подтверждение почты, окончание оплаты, приостановка доступа.
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { billingMine } from "@/lib/billing.functions";
import { authResendConfirm } from "@/lib/db.functions";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Button } from "@/components/ui/button";

export function BillingBanner() {
  const workspaceId = useActiveWorkspaceId();
  const q = useQuery({
    queryKey: ["billing-mine", workspaceId],
    queryFn: async () => {
      const res: any = await billingMine({ data: { workspaceId } });
      if (res?.error) return null;
      return res.data as {
        access: { planLabel: string; paidUntil: string | null; daysLeft: number | null; readOnly: boolean; reason: string } | null;
        emailConfirmed: boolean;
      } | null;
    },
    staleTime: 60_000,
  });

  const data = q.data;
  if (!data) return null;

  const resend = async () => {
    const res: any = await authResendConfirm();
    if (res?.error) return toast.error(res.error.message);
    toast.success("Письмо отправлено — проверьте почту");
  };

  if (!data.emailConfirmed) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <span>Подтвердите адрес почты по ссылке из письма — без этого нельзя создать новую базу.</span>
        <Button size="sm" variant="outline" onClick={resend}>Отправить письмо заново</Button>
      </div>
    );
  }

  const access = data.access;
  if (!access) return null;

  if (access.readOnly) {
    return (
      <div className="border-b bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
        {access.reason}
      </div>
    );
  }

  if (access.daysLeft !== null && access.daysLeft <= 7) {
    return (
      <div className="border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Тариф «{access.planLabel}»: доступ оплачен ещё на {access.daysLeft} дн. Продлите, чтобы работа не остановилась.
      </div>
    );
  }

  return null;
}
