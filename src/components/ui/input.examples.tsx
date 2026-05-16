import { Input } from "./input";

export function InputExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Input</h2>
      <div className="grid gap-3 sm:max-w-sm">
        <Input defaultValue="Filled value" />
        <Input placeholder="Placeholder text" />
        <Input disabled placeholder="Disabled" />
        <Input aria-invalid defaultValue="Error state" />
      </div>
    </section>
  );
}
