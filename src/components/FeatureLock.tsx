// Заглушка для раздела, который не входит в текущий тариф.
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FEATURE_LABEL, type PlanFeatures } from "@/lib/plans";

export function FeatureLock({
  feature,
  planLabel,
  hint,
}: {
  feature: keyof PlanFeatures;
  planLabel?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-6">
        <div className="flex items-center gap-2 text-base font-medium">
          <Lock className="h-4 w-4 text-muted-foreground" />
          «{FEATURE_LABEL[feature]}» не входит в ваш тариф{planLabel ? ` «${planLabel}»` : ""}
        </div>
        <p className="text-sm text-muted-foreground">
          {hint ?? "Раздел откроется после перехода на подходящий тариф."}
        </p>
        <Button asChild size="sm">
          <Link to="/tariffs">Посмотреть тарифы</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
