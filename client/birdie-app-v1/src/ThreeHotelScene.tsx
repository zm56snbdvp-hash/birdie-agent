import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Direction = "forward" | "back" | "left" | "right";

export function ThreeHotelScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const heldRef = useRef<Set<Direction>>(new Set());
  const [webglAvailable, setWebglAvailable] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setWebglAvailable(false);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f3eb);
    scene.fog = new THREE.Fog(0xf7f3eb, 18, 38);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    camera.position.set(0, 7.5, 13);
    camera.lookAt(0, 2.2, 0);

    scene.add(new THREE.HemisphereLight(0xfff7e7, 0x234734, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(6, 10, 8);
    sun.castShadow = true;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 28),
      new THREE.MeshStandardMaterial({ color: 0x4f7657, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const hotel = new THREE.Group();
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(11, 5.2, 3.6),
      new THREE.MeshStandardMaterial({ color: 0xdcc9a4, roughness: 0.86 })
    );
    building.position.set(0, 2.6, -3.1);
    building.castShadow = true;
    building.receiveShadow = true;
    hotel.add(building);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(7.6, 2.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x234734, roughness: 0.9 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 6.15, -3.1);
    roof.scale.z = 0.48;
    roof.castShadow = true;
    hotel.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2.7, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x2f2f2f, roughness: 0.7 })
    );
    door.position.set(0, 1.35, -1.18);
    hotel.add(door);

    for (const x of [-3.6, -1.8, 1.8, 3.6]) {
      const windowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 1.15, 0.18),
        new THREE.MeshStandardMaterial({ color: 0xc7a54a, emissive: 0x5a4514, emissiveIntensity: 0.22 })
      );
      windowMesh.position.set(x, 3.25, -1.18);
      hotel.add(windowMesh);
    }
    scene.add(hotel);

    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 9),
      new THREE.MeshStandardMaterial({ color: 0xe7ddc9, roughness: 1 })
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.015, 3.4);
    scene.add(path);

    const avatar = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.48, 1.05, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x234734, roughness: 0.78 })
    );
    body.position.y = 1.05;
    body.castShadow = true;
    avatar.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xdcc9a4, roughness: 0.82 })
    );
    head.position.y = 2.15;
    head.castShadow = true;
    avatar.add(head);
    avatar.position.set(0, 0, 5.7);
    scene.add(avatar);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(260, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const keyDirection = (key: string): Direction | null => {
      if (key === "ArrowUp" || key.toLowerCase() === "w") return "forward";
      if (key === "ArrowDown" || key.toLowerCase() === "s") return "back";
      if (key === "ArrowLeft" || key.toLowerCase() === "a") return "left";
      if (key === "ArrowRight" || key.toLowerCase() === "d") return "right";
      return null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = keyDirection(event.key);
      if (!direction) return;
      event.preventDefault();
      heldRef.current.add(direction);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = keyDirection(event.key);
      if (direction) heldRef.current.delete(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const clock = new THREE.Clock();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const speed = 4.1 * dt;
      let dx = 0;
      let dz = 0;
      if (heldRef.current.has("forward")) dz -= speed;
      if (heldRef.current.has("back")) dz += speed;
      if (heldRef.current.has("left")) dx -= speed;
      if (heldRef.current.has("right")) dx += speed;
      avatar.position.x = THREE.MathUtils.clamp(avatar.position.x + dx, -5.2, 5.2);
      avatar.position.z = THREE.MathUtils.clamp(avatar.position.z + dz, 0.4, 7.1);
      if (dx || dz) avatar.rotation.y = Math.atan2(dx, dz) + Math.PI;
      camera.position.x += (avatar.position.x * 0.18 - camera.position.x) * 0.04;
      camera.lookAt(avatar.position.x * 0.2, 2.1, -1.2);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
      });
    };
  }, []);

  const press = (direction: Direction) => heldRef.current.add(direction);
  const release = (direction: Direction) => heldRef.current.delete(direction);

  return (
    <section className="world-stage" aria-label="Interactive Birdie and Breakfast hotel exterior">
      <div className="world-meta">
        <div><p className="eyebrow">Hotel Hub · WebGL Sandbox</p><strong>Walk to the Birdie &amp; Breakfast entrance</strong></div>
        <span>WASD / arrows · touch controls</span>
      </div>
      {webglAvailable ? <div className="three-mount" ref={mountRef} /> : <div className="webgl-fallback"><strong>Compatibility view</strong><p>WebGL is unavailable on this browser. Golf History, Ball Vault and Personal Birdie remain usable below.</p></div>}
      <div className="touch-controls" aria-label="Avatar touch controls">
        <button onPointerDown={() => press("forward")} onPointerUp={() => release("forward")} onPointerCancel={() => release("forward")}>↑</button>
        <div>
          <button onPointerDown={() => press("left")} onPointerUp={() => release("left")} onPointerCancel={() => release("left")}>←</button>
          <button onPointerDown={() => press("back")} onPointerUp={() => release("back")} onPointerCancel={() => release("back")}>↓</button>
          <button onPointerDown={() => press("right")} onPointerUp={() => release("right")} onPointerCancel={() => release("right")}>→</button>
        </div>
      </div>
    </section>
  );
}
