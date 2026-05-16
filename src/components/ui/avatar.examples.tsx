import { Avatar } from "./avatar";

export function AvatarExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Avatar</h2>

      <div>
        <p className="mb-2 text-sm text-text-secondary">Sizes</p>
        <div className="flex items-center gap-3">
          <Avatar name="Alex Park" size="sm" />
          <Avatar name="Alex Park" size="md" />
          <Avatar name="Alex Park" size="lg" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-text-secondary">Deterministic hash colors</p>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name="Alex Park" />
          <Avatar name="Bea Khan" />
          <Avatar name="Chris Lee" />
          <Avatar name="Diana Ortega" />
          <Avatar name="Eli Rao" />
          <Avatar name="Farah Singh" />
          <Avatar name="Guo Wei" />
          <Avatar name="Hana Tanaka" />
        </div>
      </div>
    </section>
  );
}
