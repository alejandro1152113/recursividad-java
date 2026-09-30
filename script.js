document.addEventListener('DOMContentLoaded', async () => {
    const { RecursionScene } = await import('./scene.js');
    const codeEditor = document.getElementById('codeEditor');
    const methodSelect = document.getElementById('methodSelect');
    const argumentInput = document.getElementById('argumentInput');
    const callPreview = document.getElementById('callPreview');
    const editorMessage = document.getElementById('editorMessage');
    const methodCount = document.getElementById('methodCount');
    const btnAnalyze = document.getElementById('btnAnalyze');
    const btnPlay = document.getElementById('btnPlay');
    const btnStep = document.getElementById('btnStep');
    const btnBack = document.getElementById('btnBack');
    const btnReset = document.getElementById('btnReset');
    const speedRange = document.getElementById('speedRange');
    const speedValue = document.getElementById('speedValue');
    const stackContainer = document.getElementById('stackContainer');
    const sceneContainer = document.getElementById('sceneContainer');
    const scenePhase = document.getElementById('scenePhase');
    const codeLineNumber = document.getElementById('codeLineNumber');
    const codeLine = document.getElementById('codeLine');
    const btnCameraReset = document.getElementById('btnCameraReset');
    const logContainer = document.getElementById('logContainer');
    const depthValue = document.getElementById('depthValue');
    const stackCount = document.getElementById('stackCount');
    const progressFill = document.getElementById('progressFill');
    const currentEvent = document.getElementById('currentEvent');
    const stepCounter = document.getElementById('stepCounter');
    const resultValue = document.getElementById('resultValue');

    let executionTrace = [];
    let currentStep = 0;
    let isPlaying = false;
    let timer = null;
    let selectedMethods = [];
    let finalResult = null;
    const recursionScene = new RecursionScene(sceneContainer);

    btnAnalyze.addEventListener('click', analyzeAndBuildTrace);
    btnPlay.addEventListener('click', togglePlay);
    btnStep.addEventListener('click', stepNext);
    btnBack.addEventListener('click', stepBack);
    btnReset.addEventListener('click', resetSimulation);
    btnCameraReset.addEventListener('click', () => recursionScene.resetCamera());
    codeEditor.addEventListener('input', detectMethods);
    methodSelect.addEventListener('change', handleMethodChange);
    argumentInput.addEventListener('input', updateCallPreview);
    speedRange.addEventListener('input', updateSpeedLabel);

    detectMethods();
    updateSpeedLabel();

    function analyzeAndBuildTrace() {
        pause();
        try {
            const method = selectedMethods.find(item => item.name === methodSelect.value);
            if (!method) throw new Error('No se detectó un método seleccionable. Revisa la firma Java.');
            const args = parseArguments(argumentInput.value);
            if (args.length !== method.params.length) {
                throw new Error(`Este método necesita ${method.params.length} argumento${method.params.length === 1 ? '' : 's'}.`);
            }

            const simulation = buildTrace(method, args);
            executionTrace = simulation.trace;
            finalResult = simulation.result;
            currentStep = 0;
            setControlsEnabled(true);
            resultValue.textContent = `RESULTADO: ${formatValue(finalResult)}`;
            logContainer.replaceChildren();
            addLog(`Traza construida: ${executionTrace.length} eventos.`, 'system');
            renderState();
            editorMessage.textContent = `${method.name} detectado. ${executionTrace.length} eventos listos.`;
            editorMessage.classList.remove('error');
        } catch (err) {
            pause();
            executionTrace = [];
            currentStep = 0;
            finalResult = null;
            setControlsEnabled(false);
            resultValue.textContent = 'RESULTADO: --';
            renderState();
            currentEvent.textContent = 'No se pudo construir la traza';
            editorMessage.textContent = err.message;
            editorMessage.classList.add('error');
            logContainer.replaceChildren();
            addLog(err.message, 'error');
        }
    }

    function detectMethods() {
        const previousName = methodSelect.value;
        const code = codeEditor.value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ''));
        const methods = [];
        const signature = /(?:^|\n)\s*(?:(?:public|private|protected)\s+)?(?:(?:static|final|synchronized)\s+)*(?:[\w<>\[\]]+\s+)+([\w$]+)\s*\(([^)]*)\)\s*\{/g;
        let match;

        while ((match = signature.exec(code))) {
            const openingBrace = signature.lastIndex - 1;
            const closingBrace = findMatchingBrace(code, openingBrace);
            if (closingBrace < 0) continue;
            const params = match[2].trim() ? match[2].split(',').map(parameter => {
                const parts = parameter.trim().split(/\s+/);
                return parts[parts.length - 1].replace(/\[\]$/, '');
            }) : [];
            const body = code.slice(openingBrace + 1, closingBrace);
            const namePosition = match.index + match[0].lastIndexOf(match[1]);
            const method = {
                name: match[1],
                params,
                body,
                line: code.slice(0, namePosition).split('\n').length,
                bodyLine: code.slice(0, openingBrace + 1).split('\n').length,
                recursive: new RegExp(`\\b${escapeRegExp(match[1])}\\s*\\(`).test(body)
            };
            methods.push(method);
            signature.lastIndex = closingBrace + 1;
        }

        selectedMethods = methods;
        methodCount.textContent = `${methods.length} MÉTODO${methods.length === 1 ? '' : 'S'}`;
        const selectable = methods.filter(method => method.recursive);
        const choices = selectable.length ? selectable : methods;
        methodSelect.replaceChildren();

        if (!choices.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No se detectaron métodos';
            methodSelect.append(option);
            editorMessage.textContent = 'Escribe un método Java para habilitar la simulación.';
            updateCallPreview();
            return;
        }

        choices.forEach(method => {
            const option = document.createElement('option');
            option.value = method.name;
            option.textContent = `${method.name}(${method.params.join(', ')})${method.recursive ? '  · recursivo' : ''}`;
            methodSelect.append(option);
        });
        methodSelect.value = choices.some(method => method.name === previousName) ? previousName : choices[0].name;
        const selected = selectedMethods.find(method => method.name === methodSelect.value);
        const argValues = argumentInput.value.split(',').map(value => value.trim());
        if (selected && argValues.length !== selected.params.length) {
            argumentInput.value = selected.params.map((_, index) => selected.name === 'sumaDigitos' && index === 0 ? '123' : '5').join(', ');
        }
        updateCallPreview();
    }

    function updateCallPreview() {
        const name = methodSelect.value || 'método';
        const args = argumentInput.value.split(',').map(value => value.trim()).filter(Boolean);
        callPreview.textContent = `${name}(${args.join(', ')})`;
    }

    function handleMethodChange() {
        const method = selectedMethods.find(item => item.name === methodSelect.value);
        const args = argumentInput.value.split(',').map(value => value.trim());
        if (method && args.length !== method.params.length) {
            argumentInput.value = method.params.map((_, index) => method.name === 'sumaDigitos' && index === 0 ? '123' : '5').join(', ');
        }
        updateCallPreview();
    }

    function parseArguments(rawArguments) {
        if (!rawArguments.trim()) return [];
        return rawArguments.split(',').map(raw => {
            const value = Number(raw.trim());
            if (raw.trim() === '' || !Number.isFinite(value)) throw new Error(`Argumento numérico no válido: "${raw.trim()}".`);
            return value;
        });
    }

    function buildTrace(rootMethod, rootArgs) {
        const trace = [];
        const parsedMethods = new Map(selectedMethods.map(method => [method.name, { ...method, statements: parseStatements(tokenize(method.body)) }]));
        let nextId = 1;

        function invoke(methodName, args, depth) {
            if (trace.length >= 1200) throw new Error('La traza supera 1.200 eventos. Reduce el argumento inicial.');
            if (depth > 80) throw new Error('La recursión supera 80 llamadas. Revisa el caso base o reduce el argumento inicial.');
            const method = parsedMethods.get(methodName);
            if (!method) throw new Error(`No se encontró el método ${methodName}.`);
            if (args.length !== method.params.length) throw new Error(`La llamada a ${methodName} necesita ${method.params.length} argumento${method.params.length === 1 ? '' : 's'}.`);
            const id = nextId++;
            const parentId = traceStack.length ? traceStack[traceStack.length - 1] : null;
            const environment = Object.create(null);
            method.params.forEach((parameter, index) => { environment[parameter] = args[index]; });
            trace.push({ type: 'PUSH', id, parentId, name: methodName, args, depth, line: method.line });
            traceStack.push(id);

            function evaluate(node) {
                if (node.type === 'number') return node.value;
                if (node.type === 'identifier') {
                    if (node.name === 'true') return true;
                    if (node.name === 'false') return false;
                    if (!(node.name in environment)) throw new Error(`Variable "${node.name}" no reconocida en ${methodName}.`);
                    return environment[node.name];
                }
                if (node.type === 'unary') {
                    const value = evaluate(node.value);
                    if (node.operator === '-') return -value;
                    if (node.operator === '+') return +value;
                    return !value;
                }
                if (node.type === 'call') {
                    if (node.name !== methodName) throw new Error(`Solo se puede simular la llamada recursiva a ${methodName}; llamada encontrada: ${node.name}().`);
                    return invoke(node.name, node.args.map(evaluate), depth + 1);
                }
                const left = evaluate(node.left);
                if (node.operator === '&&' && !left) return false;
                if (node.operator === '||' && left) return true;
                const right = evaluate(node.right);
                switch (node.operator) {
                    case '+': return left + right;
                    case '-': return left - right;
                    case '*': return left * right;
                    case '/': return Number.isInteger(left) && Number.isInteger(right) ? Math.trunc(left / right) : left / right;
                    case '%': return left % right;
                    case '<': return left < right;
                    case '<=': return left <= right;
                    case '>': return left > right;
                    case '>=': return left >= right;
                    case '==': return left === right;
                    case '!=': return left !== right;
                    case '&&': return Boolean(left && right);
                    case '||': return Boolean(left || right);
                    default: throw new Error(`Operador no compatible: ${node.operator}.`);
                }
            }

            function execute(statements) {
                for (const statement of statements) {
                    if (statement.type === 'if') {
                        const condition = evaluate(statement.condition);
                        trace.push({ type: 'EVAL', id, line: method.bodyLine + statement.line - 1, desc: `Condición ${formatExpression(statement.condition)} → ${condition ? 'verdadera' : 'falsa'}` });
                        const result = execute(condition ? statement.consequent : statement.alternate || []);
                        if (result.returned) return result;
                    } else if (statement.type === 'block') {
                        const result = execute(statement.statements);
                        if (result.returned) return result;
                    } else if (statement.type === 'return') {
                        const value = evaluate(statement.expression);
                        trace.push({ type: 'EVAL', id, line: method.bodyLine + statement.line - 1, desc: `Evalúa retorno → ${formatValue(value)}` });
                        return { returned: true, value, line: statement.line };
                    } else if (statement.type === 'assign') {
                        environment[statement.name] = evaluate(statement.expression);
                        trace.push({ type: 'EVAL', id, line: method.bodyLine + statement.line - 1, desc: `${statement.name} = ${formatValue(environment[statement.name])}` });
                    }
                }
                return { returned: false };
            }

            try {
                const outcome = execute(method.statements);
                if (!outcome.returned) throw new Error(`${methodName} terminó sin una instrucción return compatible.`);
                trace.push({ type: 'POP', id, returnVal: outcome.value, line: method.bodyLine + outcome.line - 1 });
                return outcome.value;
            } finally {
                traceStack.pop();
            }
        }

        const traceStack = [];
        const result = invoke(rootMethod.name, rootArgs, 0);
        if (trace.length > 1200) throw new Error('La traza es demasiado grande. Reduce el argumento inicial.');
        return { trace, result };
    }

    function tokenize(source) {
        const matches = [...source.matchAll(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|===|!==|<=|>=|==|!=|&&|\|\||[+\-*/%<>()!,;={}]/g)];
        const tokens = matches.map(match => match[0]);
        tokens.lines = matches.map(match => source.slice(0, match.index).split('\n').length);
        return tokens;
    }

    function parseStatements(tokens) {
        let index = 0;

        function readUntilSemicolon() {
            const start = index;
            let depth = 0;
            while (index < tokens.length) {
                if (tokens[index] === '(') depth++;
                if (tokens[index] === ')') depth--;
                if (tokens[index] === ';' && depth === 0) break;
                index++;
            }
            const expression = tokens.slice(start, index);
            if (tokens[index] === ';') index++;
            return expression;
        }

        function readParenthesized() {
            if (tokens[index] !== '(') throw new Error('Se esperaba una condición entre paréntesis.');
            index++;
            const start = index;
            let depth = 1;
            while (index < tokens.length && depth > 0) {
                if (tokens[index] === '(') depth++;
                if (tokens[index] === ')') depth--;
                if (depth > 0) index++;
            }
            if (depth !== 0) throw new Error('Hay paréntesis sin cerrar en el método.');
            const expression = tokens.slice(start, index);
            index++;
            return expression;
        }

        function readBlock() {
            if (tokens[index] !== '{') return [readStatement()];
            index++;
            const statements = readList(true);
            if (tokens[index] !== '}') throw new Error('Hay llaves sin cerrar en el método.');
            index++;
            return statements;
        }

        function readStatement() {
            const line = tokens.lines[index] || 1;
            if (tokens[index] === 'if') {
                index++;
                const condition = parseExpression(readParenthesized());
                const consequent = readBlock();
                let alternate = null;
                if (tokens[index] === 'else') {
                    index++;
                    alternate = readBlock();
                }
                return { type: 'if', condition, consequent, alternate, line };
            }
            if (tokens[index] === '{') return { type: 'block', statements: readBlock(), line };
            if (tokens[index] === 'return') {
                index++;
                const expression = readUntilSemicolon();
                return { type: 'return', expression: parseExpression(expression), line };
            }
            const expression = readUntilSemicolon();
            const assignment = expression.indexOf('=');
            if (assignment >= 0 && expression[assignment + 1] !== '=') {
                const name = expression[assignment - 1];
                if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('Asignación no compatible en el método.');
                return { type: 'assign', name, expression: parseExpression(expression.slice(assignment + 1)), line };
            }
            if (expression.length) throw new Error(`Instrucción no compatible: ${expression.join(' ')}.`);
            return { type: 'empty' };
        }

        function readList(stopAtBrace = false) {
            const statements = [];
            while (index < tokens.length && (!stopAtBrace || tokens[index] !== '}')) {
                statements.push(readStatement());
            }
            return statements;
        }

        return readList();
    }

    function parseExpression(tokens) {
        const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
        let index = 0;

        function primary() {
            const token = tokens[index++];
            if (token === '(') {
                const expression = binary(0);
                if (tokens[index++] !== ')') throw new Error('Paréntesis sin cerrar en una expresión.');
                return expression;
            }
            if (token === '-' || token === '+' || token === '!') return { type: 'unary', operator: token, value: primary() };
            if (token === undefined) throw new Error('Falta una expresión de retorno o condición.');
            if (/^\d/.test(token)) return { type: 'number', value: Number(token) };
            if (/^[A-Za-z_$][\w$]*$/.test(token)) {
                if (tokens[index] !== '(') return { type: 'identifier', name: token };
                index++;
                const args = [];
                if (tokens[index] !== ')') {
                    while (index < tokens.length) {
                        args.push(binary(0));
                        if (tokens[index] !== ',') break;
                        index++;
                    }
                }
                if (tokens[index++] !== ')') throw new Error(`Llamada mal formada a ${token}().`);
                return { type: 'call', name: token, args };
            }
            throw new Error(`Elemento no compatible en una expresión: ${token}.`);
        }

        function binary(minimum) {
            let left = primary();
            while (precedence[tokens[index]] >= minimum) {
                const operator = tokens[index++];
                const right = binary(precedence[operator] + 1);
                left = { type: 'binary', operator, left, right };
            }
            return left;
        }

        if (!tokens.length) throw new Error('Falta una expresión.');
        const expression = binary(1);
        if (index !== tokens.length) throw new Error(`Expresión no compatible cerca de "${tokens[index]}".`);
        return expression;
    }

    function renderState() {
        const frames = [];
        const nodes = [];
        const returns = new Map();
        const visibleEvents = executionTrace.slice(0, currentStep);

        visibleEvents.forEach(event => {
            if (event.type === 'PUSH') {
                frames.push(event);
                nodes.push(event);
            } else if (event.type === 'POP') {
                returns.set(event.id, event.returnVal);
                const frameIndex = frames.findIndex(frame => frame.id === event.id);
                if (frameIndex >= 0) frames.splice(frameIndex, 1);
            }
        });

        stackContainer.replaceChildren();
        if (!frames.length) {
            stackContainer.innerHTML = '<div class="empty-state">La pila está vacía.</div>';
        } else {
            frames.slice().reverse().forEach((frame, index) => {
                const card = document.createElement('div');
                card.className = `stack-frame${index === 0 ? ' active' : ''}`;
                const call = document.createElement('span');
                call.className = 'frame-call';
                call.textContent = `${frame.name}(${frame.args.map(formatValue).join(', ')})`;
                const detail = document.createElement('small');
                detail.textContent = `#${String(frame.id).padStart(2, '0')} · NIVEL ${frame.depth + 1}`;
                card.append(call, detail);
                stackContainer.append(card);
            });
        }

        const last = visibleEvents[visibleEvents.length - 1];
        recursionScene.update(nodes, frames.map(frame => frame.id), returns, last, currentStep);
        updateSourceLine(last);
        currentEvent.textContent = last ? describeEvent(last) : 'En espera de ejecución';
        scenePhase.textContent = !last ? 'EN ESPERA' : last.type === 'PUSH' ? 'LLAMADA' : last.type === 'POP' ? 'RETORNO' : 'EVALUANDO';
        depthValue.textContent = String(frames.length).padStart(2, '0');
        stackCount.textContent = `${frames.length} ACTIVA${frames.length === 1 ? '' : 'S'}`;
        stepCounter.textContent = `${String(currentStep).padStart(2, '0')} / ${String(executionTrace.length).padStart(2, '0')}`;
        progressFill.style.width = `${executionTrace.length ? currentStep / executionTrace.length * 100 : 0}%`;
        logContainer.replaceChildren();
        visibleEvents.slice(-8).forEach(event => addLog(describeEvent(event), event.type.toLowerCase()));
        if (currentStep >= executionTrace.length && executionTrace.length) pause();
        btnBack.disabled = currentStep === 0;
        btnStep.disabled = currentStep >= executionTrace.length;
    }

    function updateSourceLine(event) {
        if (!event?.line) {
            codeLineNumber.textContent = '--';
            codeLine.textContent = 'Ejecuta una traza para recorrer el código.';
            return;
        }
        const source = codeEditor.value.split(/\r?\n/)[event.line - 1] || '';
        codeLineNumber.textContent = String(event.line).padStart(2, '0');
        codeLine.textContent = source.trim() || 'Línea de ejecución';
    }

    function stepNext() {
        if (currentStep < executionTrace.length) {
            currentStep++;
            renderState();
        }
    }

    function stepBack() {
        pause();
        if (currentStep > 0) {
            currentStep--;
            renderState();
        }
    }

    function togglePlay() {
        if (isPlaying) pause();
        else play();
    }

    function play() {
        if (currentStep >= executionTrace.length) return;
        isPlaying = true;
        btnPlay.querySelector('span:last-child').textContent = 'Pausar';
        btnPlay.querySelector('.play-icon').textContent = 'Ⅱ';
        timer = setInterval(stepNext, Math.max(100, 1850 - Number(speedRange.value)));
    }

    function pause() {
        isPlaying = false;
        btnPlay.querySelector('span:last-child').textContent = 'Reproducir';
        btnPlay.querySelector('.play-icon').textContent = '▶';
        if (timer) clearInterval(timer);
        timer = null;
    }

    function resetSimulation() {
        pause();
        currentStep = 0;
        renderState();
        addLog('Simulación reiniciada.', 'system');
    }

    function setControlsEnabled(enabled) {
        btnPlay.disabled = !enabled;
        btnStep.disabled = !enabled || executionTrace.length === 0;
        btnReset.disabled = !enabled;
        btnBack.disabled = true;
    }

    function updateSpeedLabel() {
        speedValue.value = `${(Number(speedRange.value) / 900).toFixed(1)}×`;
        if (isPlaying) {
            pause();
            play();
        }
    }

    function addLog(text, type = 'entry') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `› ${text}`;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function describeEvent(event) {
        if (event.type === 'PUSH') return `Llamada #${event.id}: ${event.name}(${event.args.map(formatValue).join(', ')})`;
        if (event.type === 'POP') return `Retorno #${event.id}: ${formatValue(event.returnVal)}`;
        return event.desc;
    }

    function formatValue(value) {
        return typeof value === 'number' ? String(Number.isInteger(value) ? value : Number(value.toFixed(4))) : String(value);
    }

    function formatExpression(node) {
        if (node.type === 'identifier') return node.name;
        if (node.type === 'number') return formatValue(node.value);
        if (node.type === 'unary') return `${node.operator}${formatExpression(node.value)}`;
        if (node.type === 'binary') return `${formatExpression(node.left)} ${node.operator} ${formatExpression(node.right)}`;
        if (node.type === 'call') return `${node.name}(...)`;
        return '';
    }

    function findMatchingBrace(source, openingBrace) {
        let depth = 0;
        for (let index = openingBrace; index < source.length; index++) {
            if (source[index] === '{') depth++;
            if (source[index] === '}') {
                depth--;
                if (depth === 0) return index;
            }
        }
        return -1;
    }

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
});