import { Input } from "./input";
import { Label } from "./label";

export function LabelExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Label</h2>
      <div className="space-y-3 sm:max-w-sm">
        <Label>Standalone label</Label>
        <div className="space-y-1">
          <Label htmlFor="example-input">Paired with input</Label>
          <Input id="example-input" placeholder="Type here" />
        </div>
      </div>
    </section>
  );
}
