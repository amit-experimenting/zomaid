import { Textarea } from "./textarea";

export function TextareaExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Textarea</h2>
      <div className="grid gap-3 sm:max-w-sm">
        <Textarea defaultValue="Filled textarea content" />
        <Textarea placeholder="Placeholder text" />
        <Textarea disabled placeholder="Disabled" />
        <Textarea aria-invalid defaultValue="Error state" />
      </div>
    </section>
  );
}
