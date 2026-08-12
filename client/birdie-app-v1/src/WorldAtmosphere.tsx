export function WorldAtmosphere() {
  return (
    <div className="world-atmosphere" aria-hidden="true">
      <div className="ambient-cloud cloud-a"><i /><i /><i /></div>
      <div className="ambient-cloud cloud-b"><i /><i /><i /></div>
      <div className="ambient-cloud cloud-c"><i /><i /><i /></div>

      <div className="ambient-steam steam-a"><i /><i /><i /></div>
      <div className="ambient-steam steam-b"><i /><i /><i /></div>

      <div className="ambient-cart">
        <span className="cart-roof" />
        <span className="cart-body" />
        <span className="cart-wheel wheel-left" />
        <span className="cart-wheel wheel-right" />
      </div>

      <div className="ambient-glow glow-a" />
      <div className="ambient-glow glow-b" />
      <div className="ambient-glow glow-c" />
    </div>
  );
}
