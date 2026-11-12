import { DESIGN_TOKENS } from '../../../specs/025-design-spec-alignment/contracts/design-tokens';

export const TokenPalette = (): React.JSX.Element => (
  <div>
    <section>
      <h2>Colors</h2>
      {Object.entries(DESIGN_TOKENS.colors).map(([key, value]) => (
        <div key={key} data-token={key} style={{ backgroundColor: value }}>
          {key}: {value}
        </div>
      ))}
    </section>
    <section>
      <h2>Radii</h2>
      {Object.entries(DESIGN_TOKENS.radius).map(([key, value]) => (
        <div key={key} data-token={`radius-${key}`} style={{ borderRadius: value }}>
          {key}: {value}
        </div>
      ))}
    </section>
    <section>
      <h2>Shadows</h2>
      {Object.entries(DESIGN_TOKENS.shadow).map(([key, value]) => (
        <div key={key} data-token={`shadow-${key}`} style={{ boxShadow: value }}>
          {key}: {value}
        </div>
      ))}
    </section>
    <section>
      <h2>Fonts</h2>
      {Object.entries(DESIGN_TOKENS.font).map(([key, value]) => (
        <div key={key} data-token={`font-${key}`} style={{ fontFamily: value }}>
          {key}: {value}
        </div>
      ))}
    </section>
    <section>
      <h2>Text Sizes</h2>
      {Object.entries(DESIGN_TOKENS.text).map(([key, value]) => (
        <div key={key} data-token={`text-${key}`} style={{ fontSize: value }}>
          {key}: {value}
        </div>
      ))}
    </section>
  </div>
);
