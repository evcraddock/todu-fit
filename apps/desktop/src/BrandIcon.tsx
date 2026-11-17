import darkIcon from "./assets/fit-icon-transparent.png";
import lightIcon from "./assets/fit-icon-light.png";

export function BrandIcon() {
  return (
    <>
      <img className="brand-icon brand-icon-light" src={lightIcon} alt="" />
      <img className="brand-icon brand-icon-dark" src={darkIcon} alt="" />
    </>
  );
}
