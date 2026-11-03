import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Dish = { id: string; name: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
declare global {
  interface Window { fit: { listDishes(): Promise<Result<Dish[]>>; createDish(name: string): Promise<Result<Dish>> } }
}
function App() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    window.fit.listDishes().then(result => {
      if (result.ok) setDishes(result.value);
      else setError(result.error.message);
    }).catch(() => setError('Unable to reach local storage.')).finally(() => setBusy(false));
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await window.fit.createDish(name);
      if (result.ok) {
        setDishes(previous => [...previous, result.value]);
        setName('');
      } else setError(result.error.message);
    } catch { setError('Unable to reach local storage.'); }
    finally { setBusy(false); }
  }
  return <main>
    <p className="eyebrow">TODU FIT · DESKTOP PROOF</p>
    <h1>Your dishes</h1>
    <p>Saved locally on this computer. Close and reopen the app to pick up where you left off.</p>
    <form onSubmit={create}>
      <label htmlFor="name">Dish name</label>
      <div className="row"><input id="name" value={name} onChange={e => setName(e.target.value)} disabled={busy} autoFocus />
      <button disabled={busy || !name.trim()}>Save dish</button></div>
    </form>
    {error && <p role="alert">{error}</p>}
    <section aria-label="Saved dishes" aria-busy={busy}>
      <h2>Saved dishes</h2>
      {dishes.length ? <ul>{dishes.map(dish => <li key={dish.id} data-dish-id={dish.id}>{dish.name}</li>)}</ul> :
        <p>{busy ? 'Opening local storage…' : 'No dishes yet. Add your first dish above.'}</p>}
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
