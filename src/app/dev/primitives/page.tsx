import { notFound } from "next/navigation";
import { ButtonExamples } from "@/components/ui/button.examples";
import { CardExamples } from "@/components/ui/card.examples";
import { DialogExamples } from "@/components/ui/dialog.examples";
import { InputExamples } from "@/components/ui/input.examples";
import { LabelExamples } from "@/components/ui/label.examples";
import { SheetExamples } from "@/components/ui/sheet.examples";
import { TextareaExamples } from "@/components/ui/textarea.examples";
import { BannerExamples } from "@/components/ui/banner.examples";
import { IconButtonExamples } from "@/components/ui/icon-button.examples";
import { ListRowExamples } from "@/components/ui/list-row.examples";
import { AvatarExamples } from "@/components/ui/avatar.examples";
import { TopAppBarExamples } from "@/components/ui/top-app-bar.examples";
import { TabBarExamples } from "@/components/ui/tab-bar.examples";
import { SubmitButtonExamples } from "@/components/ui/submit-button.examples";

export default function PrimitivesCatalog() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-10 p-4">
      <h1 className="text-2xl font-bold">Primitives</h1>
      <ButtonExamples />
      <SubmitButtonExamples />
      <CardExamples />
      <DialogExamples />
      <InputExamples />
      <LabelExamples />
      <SheetExamples />
      <TextareaExamples />
      <BannerExamples />
      <IconButtonExamples />
      <ListRowExamples />
      <AvatarExamples />
      <TopAppBarExamples />
      <TabBarExamples />
    </div>
  );
}
