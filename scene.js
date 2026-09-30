import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_VISIBLE_CALLS = 150;

export class RecursionScene {
    constructor(container) {
        this.container = container;
        this.nodes = new Map();
        this.edges = new Map();
        this.packets = [];
        this.lastEventKey = '';
        this.focusTarget = new THREE.Vector3(0, 0, -1);
        this.cameraOffset = new THREE.Vector3(5.8, 4.5, 9.2);
        this.clock = new THREE.Timer();
        this.clock.connect(document);
        this.enabled = false;

        try {
            this.initialize();
            this.enabled = true;
            this.animate();
        } catch (error) {
            const fallback = document.createElement('div');
            fallback.className = 'scene-error';
            fallback.textContent = 'No se pudo iniciar WebGL. Comprueba que el navegador permita aceleración gráfica.';
            container.replaceChildren(fallback);
        }
    }

    initialize() {
        const width = Math.max(this.container.clientWidth, 1);
        const height = Math.max(this.container.clientHeight, 1);
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#101a16');
        this.scene.fog = new THREE.FogExp2('#101a16', 0.012);
        this.camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 320);
        this.camera.position.copy(this.focusTarget).add(this.cameraOffset);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.renderer.domElement.className = 'scene-canvas';
        this.renderer.domElement.setAttribute('aria-hidden', 'true');
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.065;
        this.controls.minDistance = 4.5;
        this.controls.maxDistance = 32;
        this.controls.maxPolarAngle = Math.PI * 0.49;
        this.controls.target.copy(this.focusTarget);
        this.controls.update();

        this.world = new THREE.Group();
        this.scene.add(this.world);
        this.scene.add(new THREE.HemisphereLight('#d8f1dc', '#17221d', 2.1));
        const keyLight = new THREE.DirectionalLight('#e4ffd1', 3.1);
        keyLight.position.set(3, 8, 5);
        this.scene.add(keyLight);
        const rimLight = new THREE.PointLight('#6ce4d1', 65, 40, 2);
        rimLight.position.set(-5, 1, -7);
        this.scene.add(rimLight);
        const coralLight = new THREE.PointLight('#ff775e', 32, 30, 2);
        coralLight.position.set(5, 2, -18);
        this.scene.add(coralLight);

        const floor = new THREE.GridHelper(300, 100, '#456252', '#273b31');
        floor.position.set(0, -1.45, -115);
        floor.material.transparent = true;
        floor.material.opacity = 0.34;
        this.scene.add(floor);
        this.addAmbientParticles();

        this.nodeGeometry = new THREE.IcosahedronGeometry(0.38, 2);
        this.ringGeometry = new THREE.TorusGeometry(0.53, 0.018, 8, 48);
        this.packetGeometry = new THREE.IcosahedronGeometry(0.085, 1);
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pickables = new Map();
        this.pointerStart = null;
        this.renderer.domElement.addEventListener('pointerdown', event => {
            this.pointerStart = { x: event.clientX, y: event.clientY };
        });
        this.renderer.domElement.addEventListener('pointerup', event => this.handlePick(event));

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
    }

    addAmbientParticles() {
        const positions = [];
        const colors = [];
        const colorA = new THREE.Color('#7fe0cf');
        const colorB = new THREE.Color('#d5f36a');
        for (let index = 0; index < 520; index++) {
            positions.push((Math.random() - 0.5) * 42, (Math.random() - 0.5) * 18, 12 - Math.random() * 250);
            const color = colorA.clone().lerp(colorB, Math.random() * 0.65);
            colors.push(color.r, color.g, color.b);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.58, sizeAttenuation: true });
        this.scene.add(new THREE.Points(geometry, material));
    }

    update(nodes, activeIds, returns, event, stepIndex) {
        if (!this.enabled) return;
        const nodeById = new Map(nodes.map(node => [node.id, node]));
        const active = new Set(activeIds);
        const visibleIds = new Set(nodes.slice(-MAX_VISIBLE_CALLS).map(node => node.id));
        activeIds.forEach(id => {
            let node = nodeById.get(id);
            while (node) {
                visibleIds.add(node.id);
                node = node.parentId === null ? null : nodeById.get(node.parentId);
            }
        });
        const visibleNodes = nodes.filter(node => visibleIds.has(node.id));
        const positions = this.layout(visibleNodes);
        const latestId = event && Number.isInteger(event.id) ? event.id : null;

        visibleNodes.forEach(node => {
            let object = this.nodes.get(node.id);
            if (!object) {
                object = this.createNode(node);
                this.nodes.set(node.id, object);
                this.world.add(object.group);
            }
            object.node = node;
            object.target.copy(positions.get(node.id));
            object.active = active.has(node.id);
            object.done = returns.has(node.id);
            object.material.color.set(object.active ? '#d5f36a' : object.done ? '#84dfcf' : '#ff9278');
            object.material.emissive.set(object.active ? '#829c27' : object.done ? '#267c70' : '#853d31');
            object.ringMaterial.color.set(object.active ? '#e4ff8d' : object.done ? '#8ef4df' : '#ffad8d');
            object.ringMaterial.opacity = object.active ? 0.95 : 0.56;
            const shouldLabel = object.active || node.id === latestId;
            if (shouldLabel) this.showLabel(object, returns.get(node.id));
            else this.hideLabel(object);
        });

        for (const [id, object] of this.nodes) {
            if (!visibleIds.has(id)) {
                this.world.remove(object.group);
                this.disposeNode(object);
                this.nodes.delete(id);
                this.pickables.delete(object.sphere);
            }
        }

        const visibleSet = new Set(visibleNodes.map(node => node.id));
        for (const [id, line] of this.edges) {
            if (!visibleSet.has(id)) {
                this.world.remove(line);
                line.geometry.dispose();
                this.edges.delete(id);
            }
        }
        visibleNodes.forEach(node => {
            if (node.parentId === null || !visibleSet.has(node.parentId) || this.edges.has(node.id)) return;
            const material = new THREE.LineDashedMaterial({ color: '#84dfcf', dashSize: 0.11, gapSize: 0.08, transparent: true, opacity: 0.58 });
            const line = new THREE.Line(new THREE.BufferGeometry(), material);
            line.userData.childId = node.id;
            line.userData.parentId = node.parentId;
            this.edges.set(node.id, line);
            this.world.add(line);
        });

        visibleNodes.forEach(node => {
            const object = this.nodes.get(node.id);
            if (object) object.targetScale = object.active ? 1.15 : object.done ? 0.88 : 0.96;
        });

        const activeNode = activeIds.length ? this.nodes.get(activeIds[activeIds.length - 1]) : null;
        if (activeNode) {
            this.focusTarget.set(activeNode.target.x * 0.55, 0, activeNode.target.z - 1.4);
        } else if (latestId !== null && this.nodes.has(latestId)) {
            const lastNode = this.nodes.get(latestId);
            this.focusTarget.set(lastNode.target.x * 0.45, 0, lastNode.target.z - 1.4);
        }
        const eventKey = `${stepIndex}:${event?.type || 'none'}:${event?.id || 'none'}`;
        if (eventKey !== this.lastEventKey) {
            this.lastEventKey = eventKey;
            if (event?.type === 'PUSH' || event?.type === 'POP') this.spawnPacket(event, positions);
        }
    }

    layout(nodes) {
        const children = new Map();
        nodes.forEach(node => {
            const list = children.get(node.parentId) || [];
            list.push(node);
            children.set(node.parentId, list);
        });
        let leafIndex = 0;
        const xPositions = new Map();
        const place = node => {
            const descendants = children.get(node.id) || [];
            if (!descendants.length) {
                const x = leafIndex++ * 1.52;
                xPositions.set(node.id, x);
                return x;
            }
            const values = descendants.map(place);
            const x = (values[0] + values[values.length - 1]) / 2;
            xPositions.set(node.id, x);
            return x;
        };
        const roots = children.get(null) || nodes.filter(node => !nodes.some(candidate => candidate.id === node.parentId));
        roots.forEach(place);
        const center = Math.max(0, (leafIndex - 1) * 1.52 / 2);
        const positions = new Map();
        nodes.forEach(node => positions.set(node.id, new THREE.Vector3((xPositions.get(node.id) || 0) - center, 0, -node.depth * 2.35)));
        return positions;
    }

    createNode(node) {
        const group = new THREE.Group();
        const material = new THREE.MeshStandardMaterial({ color: '#ff9278', emissive: '#853d31', emissiveIntensity: 0.55, metalness: 0.38, roughness: 0.22 });
        const sphere = new THREE.Mesh(this.nodeGeometry, material);
        sphere.userData.id = node.id;
        this.pickables.set(sphere, node.id);
        group.add(sphere);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffad8d', transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        return {
            group,
            sphere,
            ring,
            material,
            ringMaterial,
            node,
            target: new THREE.Vector3(),
            targetScale: 1,
            label: null,
            active: false,
            done: false
        };
    }

    showLabel(object, returnValue) {
        const labelText = `#${object.node.id}  ${object.node.name}(${object.node.args.join(', ')})${returnValue === undefined ? '' : `  = ${returnValue}`}`;
        if (object.label?.userData.text === labelText) {
            object.label.visible = true;
            return;
        }
        this.hideLabel(object);
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 96;
        const context = canvas.getContext('2d');
        context.fillStyle = '#101a16dd';
        context.fillRect(2, 2, 508, 92);
        context.strokeStyle = object.active ? '#d5f36a' : '#84dfcf';
        context.lineWidth = 3;
        context.strokeRect(3, 3, 506, 90);
        context.fillStyle = '#f3f7ef';
        context.font = '500 28px monospace';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(labelText.slice(0, 35), 256, 49);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        sprite.scale.set(2.25, 0.43, 1);
        sprite.position.set(0, 0.96, 0);
        sprite.userData.text = labelText;
        object.group.add(sprite);
        object.label = sprite;
    }

    hideLabel(object) {
        if (!object.label) return;
        object.group.remove(object.label);
        object.label.material.map?.dispose();
        object.label.material.dispose();
        object.label = null;
    }

    spawnPacket(event, positions) {
        const current = positions.get(event.id);
        if (!current) return;
        const parent = event.parentId === null ? null : positions.get(event.parentId);
        const from = event.type === 'POP' ? current.clone() : parent?.clone() || current.clone().add(new THREE.Vector3(0, 2.4, 2.2));
        const to = event.type === 'POP' ? parent?.clone() || current.clone().add(new THREE.Vector3(0, 2.6, 2.4)) : current.clone();
        const control = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.85, 0));
        const curve = new THREE.QuadraticBezierCurve3(from, control, to);
        const material = new THREE.MeshBasicMaterial({ color: event.type === 'POP' ? '#d5f36a' : '#84dfcf', transparent: true });
        const mesh = new THREE.Mesh(this.packetGeometry, material);
        mesh.position.copy(from);
        this.scene.add(mesh);
        this.packets.push({ mesh, curve, elapsed: 0, duration: 0.72 });
    }

    handlePick(event) {
        if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObjects([...this.pickables.keys()])[0];
        if (hit) {
            const object = this.nodes.get(this.pickables.get(hit.object));
            if (object) this.focusTarget.set(object.target.x, 0, object.target.z - 1.2);
        }
        this.pointerStart = null;
    }

    resize() {
        if (!this.renderer || !this.container.clientWidth || !this.container.clientHeight) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    resetCamera() {
        if (!this.enabled) return;
        this.controls.target.copy(this.focusTarget);
        this.camera.position.copy(this.focusTarget).add(this.cameraOffset);
        this.controls.update();
    }

    animate(timestamp) {
        if (!this.enabled) return;
        requestAnimationFrame(timestamp => this.animate(timestamp));
        this.clock.update(timestamp);
        const delta = Math.min(this.clock.getDelta(), 0.05);
        const elapsed = this.clock.getElapsed();
        const targetShift = this.focusTarget.clone().sub(this.controls.target).multiplyScalar(0.035);
        this.controls.target.add(targetShift);
        this.camera.position.add(targetShift);

        this.nodes.forEach(object => {
            object.group.position.lerp(object.target, 0.12);
            const scale = THREE.MathUtils.damp(object.group.scale.x, object.targetScale, 9, delta);
            object.group.scale.setScalar(scale);
            object.ring.rotation.z += delta * (object.active ? 1.4 : 0.36);
            object.ring.rotation.y = Math.sin(elapsed * 0.7 + object.node.id) * 0.16;
            object.sphere.rotation.y += delta * 0.42;
            if (object.active) object.group.position.y = Math.sin(elapsed * 2.1 + object.node.id) * 0.075;
        });

        this.edges.forEach(line => {
            const child = this.nodes.get(line.userData.childId);
            const parent = this.nodes.get(line.userData.parentId);
            if (!child || !parent) return;
            const start = parent.group.position.clone();
            const end = child.group.position.clone();
            start.y += 0.05;
            end.y += 0.05;
            line.geometry.setFromPoints([start, end]);
            line.computeLineDistances();
            line.material.dashOffset = -elapsed * 0.16;
            line.material.opacity = child.active ? 0.92 : 0.42;
            line.material.color.set(child.active ? '#d5f36a' : '#84dfcf');
        });

        this.packets = this.packets.filter(packet => {
            packet.elapsed += delta;
            const progress = Math.min(packet.elapsed / packet.duration, 1);
            packet.mesh.position.copy(packet.curve.getPoint(progress));
            packet.mesh.scale.setScalar(0.65 + Math.sin(progress * Math.PI) * 1.2);
            packet.mesh.material.opacity = 1 - progress * 0.75;
            if (progress >= 1) {
                this.scene.remove(packet.mesh);
                packet.mesh.material.dispose();
                return false;
            }
            return true;
        });

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    disposeNode(object) {
        this.hideLabel(object);
        object.material.dispose();
        object.ringMaterial.dispose();
    }
}
