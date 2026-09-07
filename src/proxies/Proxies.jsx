import React from 'react';
import { Edges } from '@react-three/drei';
import { PROXY_BOUNDS } from './registry.js';

// Proxys de blocking : des primitives, mais dont la silhouette se lit d'un coup
// d'oeil. Les personnes restent des cylindres (convention previz) ; tout le
// reste recoit une forme approchee reconnaissable.
//
// Pour ajouter un type : une entree dans registry.js et un composant ici.

const HALF_PI = Math.PI / 2;

function Solid({ color, opacity = 1, children, edge = '#0a0b0d', edgeOpacity = 0.55 }) {
  return (
    <mesh castShadow receiveShadow>
      {children}
      <meshStandardMaterial
        color={color}
        flatShading
        roughness={0.72}
        metalness={0.05}
        transparent={opacity < 1}
        opacity={opacity}
      />
      <Edges threshold={20} color={edge} transparent opacity={edgeOpacity} />
    </mesh>
  );
}

const Part = ({ position, rotation, children }) => (
  <group position={position} rotation={rotation}>
    {children}
  </group>
);

/** Roue : cylindre couche sur l'axe X. */
function Wheel({ x, y, z, radius = 0.33, width = 0.24 }) {
  return (
    <Part position={[x, y, z]} rotation={[0, 0, HALF_PI]}>
      <Solid color="#15171b" edgeOpacity={0.35}>
        <cylinderGeometry args={[radius, radius, width, 14]} />
      </Solid>
    </Part>
  );
}

// --- Personne -------------------------------------------------------------
// Cylindre + tete spherique + petit nez conique. Le nez n'est pas decoratif :
// c'est ce qui rend l'orientation lisible en plan large.
function HumanProxy({ color, height = 1.7 }) {
  const bodyH = height * 0.8;
  const headR = height * 0.085;
  return (
    <group>
      <Part position={[0, bodyH / 2, 0]}>
        <Solid color={color}>
          <cylinderGeometry args={[height * 0.13, height * 0.145, bodyH, 16]} />
        </Solid>
      </Part>
      <Part position={[0, bodyH + headR * 0.9, 0]}>
        <Solid color={color}>
          <sphereGeometry args={[headR, 14, 10]} />
        </Solid>
      </Part>
      <Part position={[0, height * 0.66, height * 0.115]} rotation={[HALF_PI, 0, 0]}>
        <Solid color={color} edgeOpacity={0.3}>
          <coneGeometry args={[height * 0.045, height * 0.13, 8]} />
        </Solid>
      </Part>
    </group>
  );
}

// --- Vehicules ------------------------------------------------------------
function CarProxy({ color }) {
  const b = PROXY_BOUNDS.car;
  return (
    <group>
      <Part position={[0, 0.62, 0]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 0.62, b.depth]} />
        </Solid>
      </Part>
      {/* Cabine effilee, decalee vers l'arriere : c'est ce decalage qui donne
          la lecture "avant / arriere" du vehicule. */}
      <Part position={[0, 1.16, -0.25]}>
        <Solid color={color}>
          <boxGeometry args={[b.width * 0.88, 0.56, b.depth * 0.46]} />
        </Solid>
      </Part>
      <Wheel x={-b.width / 2 + 0.1} y={0.33} z={b.depth * 0.31} />
      <Wheel x={b.width / 2 - 0.1} y={0.33} z={b.depth * 0.31} />
      <Wheel x={-b.width / 2 + 0.1} y={0.33} z={-b.depth * 0.31} />
      <Wheel x={b.width / 2 - 0.1} y={0.33} z={-b.depth * 0.31} />
    </group>
  );
}

function TruckProxy({ color }) {
  const b = PROXY_BOUNDS.truck;
  return (
    <group>
      <Part position={[0, 1.55, b.depth * 0.32]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 1.9, b.depth * 0.3]} />
        </Solid>
      </Part>
      <Part position={[0, 1.85, -b.depth * 0.16]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 2.5, b.depth * 0.62]} />
        </Solid>
      </Part>
      <Wheel x={-b.width / 2 + 0.15} y={0.5} z={b.depth * 0.3} radius={0.5} width={0.3} />
      <Wheel x={b.width / 2 - 0.15} y={0.5} z={b.depth * 0.3} radius={0.5} width={0.3} />
      <Wheel x={-b.width / 2 + 0.15} y={0.5} z={-b.depth * 0.22} radius={0.5} width={0.3} />
      <Wheel x={b.width / 2 - 0.15} y={0.5} z={-b.depth * 0.22} radius={0.5} width={0.3} />
      <Wheel x={-b.width / 2 + 0.15} y={0.5} z={-b.depth * 0.38} radius={0.5} width={0.3} />
      <Wheel x={b.width / 2 - 0.15} y={0.5} z={-b.depth * 0.38} radius={0.5} width={0.3} />
    </group>
  );
}

function BikeProxy({ color }) {
  return (
    <group>
      <Part position={[0, 0.35, 0.6]} rotation={[0, 0, HALF_PI]}>
        <Solid color="#15171b" edgeOpacity={0.35}>
          <torusGeometry args={[0.34, 0.05, 8, 20]} />
        </Solid>
      </Part>
      <Part position={[0, 0.35, -0.6]} rotation={[0, 0, HALF_PI]}>
        <Solid color="#15171b" edgeOpacity={0.35}>
          <torusGeometry args={[0.34, 0.05, 8, 20]} />
        </Solid>
      </Part>
      <Part position={[0, 0.62, 0]} rotation={[HALF_PI, 0, 0]}>
        <Solid color={color}>
          <cylinderGeometry args={[0.045, 0.045, 1.2, 8]} />
        </Solid>
      </Part>
      <Part position={[0, 0.88, 0.5]}>
        <Solid color={color}>
          <cylinderGeometry args={[0.035, 0.035, 0.5, 8]} />
        </Solid>
      </Part>
    </group>
  );
}

// --- Mobilier -------------------------------------------------------------
function Legs({ w, d, h, color, radius = 0.04 }) {
  const xs = [-w / 2 + radius * 2.5, w / 2 - radius * 2.5];
  const zs = [-d / 2 + radius * 2.5, d / 2 - radius * 2.5];
  return (
    <>
      {xs.map((x) =>
        zs.map((z) => (
          <Part key={`${x}:${z}`} position={[x, h / 2, z]}>
            <Solid color={color} edgeOpacity={0.3}>
              <cylinderGeometry args={[radius, radius, h, 8]} />
            </Solid>
          </Part>
        ))
      )}
    </>
  );
}

function TableProxy({ color, type = 'table' }) {
  const b = PROXY_BOUNDS[type] || PROXY_BOUNDS.table;
  const topT = 0.07;
  return (
    <group>
      <Part position={[0, b.height - topT / 2, 0]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, topT, b.depth]} />
        </Solid>
      </Part>
      <Legs w={b.width} d={b.depth} h={b.height - topT} color={color} />
    </group>
  );
}

function ChairProxy({ color }) {
  const b = PROXY_BOUNDS.chair;
  const seat = 0.45;
  return (
    <group>
      <Part position={[0, seat, 0]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 0.07, b.depth]} />
        </Solid>
      </Part>
      <Part position={[0, seat + 0.26, -b.depth / 2 + 0.04]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 0.5, 0.07]} />
        </Solid>
      </Part>
      <Legs w={b.width} d={b.depth} h={seat} color={color} radius={0.03} />
    </group>
  );
}

function SofaProxy({ color }) {
  const b = PROXY_BOUNDS.sofa;
  return (
    <group>
      <Part position={[0, 0.22, 0]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 0.44, b.depth]} />
        </Solid>
      </Part>
      <Part position={[0, 0.62, -b.depth / 2 + 0.12]}>
        <Solid color={color}>
          <boxGeometry args={[b.width, 0.42, 0.24]} />
        </Solid>
      </Part>
    </group>
  );
}

// --- Vegetation et exterieur ---------------------------------------------
function TreeProxy({ color }) {
  const b = PROXY_BOUNDS.tree;
  return (
    <group>
      <Part position={[0, b.height * 0.28, 0]}>
        <Solid color="#4A3A2A" edgeOpacity={0.3}>
          <cylinderGeometry args={[0.16, 0.24, b.height * 0.56, 10]} />
        </Solid>
      </Part>
      <Part position={[0, b.height * 0.68, 0]}>
        <Solid color={color}>
          <sphereGeometry args={[b.width * 0.46, 10, 8]} />
        </Solid>
      </Part>
      <Part position={[0, b.height * 0.9, 0]}>
        <Solid color={color}>
          <sphereGeometry args={[b.width * 0.3, 9, 7]} />
        </Solid>
      </Part>
    </group>
  );
}

function PlantProxy({ color }) {
  return (
    <group>
      <Part position={[0, 0.18, 0]}>
        <Solid color="#7A5540" edgeOpacity={0.3}>
          <cylinderGeometry args={[0.2, 0.16, 0.36, 10]} />
        </Solid>
      </Part>
      <Part position={[0, 0.72, 0]}>
        <Solid color={color}>
          <coneGeometry args={[0.34, 0.85, 9]} />
        </Solid>
      </Part>
    </group>
  );
}

function LampProxy({ color }) {
  const b = PROXY_BOUNDS.lamp;
  return (
    <group>
      <Part position={[0, 0.06, 0]}>
        <Solid color={color} edgeOpacity={0.3}>
          <cylinderGeometry args={[0.22, 0.26, 0.12, 10]} />
        </Solid>
      </Part>
      <Part position={[0, b.height / 2, 0]}>
        <Solid color={color}>
          <cylinderGeometry args={[0.07, 0.09, b.height, 10]} />
        </Solid>
      </Part>
      <Part position={[0, b.height - 0.12, 0.22]}>
        <Solid color="#C9B27A" edgeOpacity={0.25}>
          <boxGeometry args={[0.3, 0.16, 0.62]} />
        </Solid>
      </Part>
    </group>
  );
}

// --- Divers ---------------------------------------------------------------
function CrateProxy({ color }) {
  const b = PROXY_BOUNDS.crate;
  return (
    <Part position={[0, b.height / 2, 0]}>
      <Solid color={color}>
        <boxGeometry args={[b.width, b.height, b.depth]} />
      </Solid>
    </Part>
  );
}

function DoorProxy({ color }) {
  const b = PROXY_BOUNDS.door;
  const t = 0.09;
  return (
    <group>
      {[-1, 1].map((s) => (
        <Part key={s} position={[s * (b.width / 2), b.height / 2, 0]}>
          <Solid color={color}>
            <boxGeometry args={[t, b.height, b.depth]} />
          </Solid>
        </Part>
      ))}
      <Part position={[0, b.height, 0]}>
        <Solid color={color}>
          <boxGeometry args={[b.width + t, t, b.depth]} />
        </Solid>
      </Part>
    </group>
  );
}

function GenericProxy({ color, bounds }) {
  const b = bounds || PROXY_BOUNDS.generic;
  return (
    <Part position={[0, b.height / 2, 0]}>
      <Solid color={color} opacity={0.9}>
        <boxGeometry args={[b.width, b.height, b.depth]} />
      </Solid>
    </Part>
  );
}

const REGISTRY = {
  human: HumanProxy,
  car: CarProxy,
  truck: TruckProxy,
  bike: BikeProxy,
  table: TableProxy,
  desk: (p) => <TableProxy {...p} type="desk" />,
  chair: ChairProxy,
  sofa: SofaProxy,
  tree: TreeProxy,
  plant: PlantProxy,
  lamp: LampProxy,
  crate: CrateProxy,
  door: DoorProxy,
  generic: GenericProxy,
};

/**
 * Rend le proxy correspondant au type. Le halo de selection entoure la
 * silhouette sans la masquer.
 */
export default function Proxy({ type, color, height, scale = 1, selected = false, bounds }) {
  const Component = REGISTRY[type] || GenericProxy;
  const b = bounds || PROXY_BOUNDS[type] || PROXY_BOUNDS.generic;
  return (
    <group scale={scale}>
      <Component color={color} height={height} bounds={b} />
      {selected && (
        <mesh position={[0, b.height / 2, 0]}>
          <boxGeometry args={[b.width * 1.25 + 0.2, b.height * 1.1 + 0.2, b.depth * 1.25 + 0.2]} />
          <meshBasicMaterial color="#F27D26" wireframe transparent opacity={0.55} />
        </mesh>
      )}
    </group>
  );
}
