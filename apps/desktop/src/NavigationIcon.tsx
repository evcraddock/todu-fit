export function NavigationIcon({ page }: { page: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {page === "Dishes" ? (
        <>
          <circle cx="13" cy="12" r="7" />
          <path d="M3 3v6m3-6v6M3 6h3M4.5 9v12" />
        </>
      ) : page === "Meal plans" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18M7 15h2m6 0h2m-10 3h2" />
        </>
      ) : page === "Food log" ? (
        <>
          <path d="M9 4H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-4" />
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <path d="m7 11 1 1 2-2m3 1h4m-10 5h10" />
        </>
      ) : page === "Shopping" ? (
        <>
          <path d="M2 3h3l3 12h11l3-9H6" />
          <circle cx="9" cy="20" r="1" />
          <circle cx="18" cy="20" r="1" />
        </>
      ) : page === "Water" ? (
        <path d="M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13Z" />
      ) : (
        <>
          <path d="m9.5 3-.5 2a7.5 7.5 0 0 0-1.8 1L5.2 5.4 2.7 9.6l1.5 1.4a7.5 7.5 0 0 0 0 2l-1.5 1.4 2.5 4.2 2-.6a7.5 7.5 0 0 0 1.8 1l.5 2h5l.5-2a7.5 7.5 0 0 0 1.8-1l2 .6 2.5-4.2-1.5-1.4a7.5 7.5 0 0 0 0-2l1.5-1.4-2.5-4.2-2 .6A7.5 7.5 0 0 0 15 5l-.5-2z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
