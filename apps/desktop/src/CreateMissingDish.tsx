import { call, type Dish } from "./api";
import { useLoad } from "./ui";

export function CreateMissingDish({
  name,
  request,
  onCreate,
  onUse,
}: {
  name: string;
  request: string;
  onCreate: (request: string) => void;
  onUse: (dish: Dish) => void;
}) {
  // Recheck on return from the editor, where the requested dish may just have been saved.
  const matches = useLoad(
    () => call<Dish[]>({ type: "dishes_list", query: name }, "dishes"),
    name,
    name,
  );
  if (!matches.data) return null;
  const existing = matches.data.find(
    (d) => d.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (existing)
    return (
      <button className="missing-dish-action" onClick={() => onUse(existing)}>
        Use {existing.name}
      </button>
    );
  return (
    <button
      className="missing-dish-action"
      onClick={() =>
        onCreate(`Create a dish called ${name}.

${request}`)
      }
    >
      Create {name}
    </button>
  );
}
