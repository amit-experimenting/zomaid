import { requireHousehold } from "@/lib/auth/require";
import { MainNav } from "@/components/site/main-nav";
import { UploadForm } from "@/components/bills/upload-form";

export default async function NewBillPage() {
  await requireHousehold();
  return (
    <main className="mx-auto max-w-md">
      <MainNav active="bills" />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Upload bill</h1>
      </header>
      <UploadForm />
    </main>
  );
}
