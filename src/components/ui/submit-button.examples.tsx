import { SubmitButton } from "./submit-button";

export function SubmitButtonExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">SubmitButton</h2>
      <p className="text-sm text-text-secondary">
        SubmitButton reads <code>useFormStatus()</code>, so its loading spinner only
        activates inside a <code>&lt;form action=&hellip;&gt;</code>. Wrapping in a
        no-op form here so it renders.
      </p>
      <form action={async () => {}} className="flex flex-wrap gap-3">
        <SubmitButton>Default submit</SubmitButton>
        <SubmitButton variant="secondary">Secondary submit</SubmitButton>
        <SubmitButton disabled>Disabled submit</SubmitButton>
      </form>
    </section>
  );
}
