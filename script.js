/**
 * ==========================================================================
 * PASTEL CALC - JAVASCRIPT CORE ENGINE
 * Implements DOM manipulation, event handling, input parsing, arithmetic,
 * error handling, keyboard listeners, history drawer, and Web Audio clicks.
 * ==========================================================================
 */

document.addEventListener('DOMContentLoaded', () => {

    // ----------------------------------------------------------------------
    // 1. STATE VARIABLES
    // ----------------------------------------------------------------------
    let currentInput = '0';            // Holds the active number string being typed
    let previousExpression = '';       // Holds the running equation (e.g. "12 + 5 ×")
    let pendingOperator = null;        // Active operator (+, -, *, /)
    let shouldResetDisplay = false;   // Flag to reset display on next number key after operator/equals
    let isErrorState = false;         // Tracks if calculator is currently displaying an error
    let soundEnabled = true;          // Audio click feedback toggle
    let calculationHistory = [];      // Stores list of past calculation objects

    // ----------------------------------------------------------------------
    // 2. DOM ELEMENT REFERENCES
    // ----------------------------------------------------------------------
    const currentInputEl = document.getElementById('currentInput');
    const previousExpressionEl = document.getElementById('previousExpression');
    const keypadGrid = document.querySelector('.keypad-grid');
    const equalsBtn = document.getElementById('btn-equals');
    const soundToggleBtn = document.getElementById('soundToggleBtn');
    const historyToggleBtn = document.getElementById('historyToggleBtn');
    const historyPanel = document.getElementById('historyPanel');
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const soundOnIcon = soundToggleBtn.querySelector('.sound-on');
    const soundOffIcon = soundToggleBtn.querySelector('.sound-off');

    // ----------------------------------------------------------------------
    // 3. SOUND SYNTHESIZER (Web Audio API)
    // ----------------------------------------------------------------------
    // Generates a soft, pleasant pastel bubble click sound without external assets
    let audioCtx = null;

    function playClickSound(freq = 600, duration = 0.04) {
        if (!soundEnabled) return;
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(freq / 2, audioCtx.currentTime + duration);

            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch (e) {
            // Audio context fallback if audio is not permitted
        }
    }

    // ----------------------------------------------------------------------
    // 4. CORE FUNCTIONS (Required Specifications)
    // ----------------------------------------------------------------------

    /**
     * Updates the calculator DOM display elements smoothly.
     * Also handles font auto-resizing for large input numbers.
     */
    function updateDisplay() {
        if (isErrorState) {
            currentInputEl.textContent = 'Error';
            currentInputEl.classList.add('error-text');
            return;
        } else {
            currentInputEl.classList.remove('error-text');
        }

        // Format number display with standard thousands separators if applicable
        currentInputEl.textContent = formatDisplayValue(currentInput);
        previousExpressionEl.textContent = previousExpression;

        // Auto-scale font size based on input length to fit display box
        const len = currentInput.length;
        if (len > 12) {
            currentInputEl.style.fontSize = '1.5rem';
        } else if (len > 8) {
            currentInputEl.style.fontSize = '1.9rem';
        } else {
            currentInputEl.style.fontSize = '';
        }
    }

    /**
     * Helper to format numbers cleanly for display.
     * Prevents breaking formatting on partial input like "5." or negative "-0".
     */
    function formatDisplayValue(valStr) {
        if (!valStr) return '0';
        if (valStr === '-') return '-';
        if (valStr.endsWith('.')) return valStr;

        // Separate integer and fraction parts
        const parts = valStr.split('.');
        const intPart = parts[0];
        const decimalPart = parts[1];

        // Format integer part with commas if within standard safe number limits
        let formattedInt = intPart;
        if (!isNaN(intPart) && Math.abs(parseFloat(intPart)) < 1e15) {
            formattedInt = Number(intPart).toLocaleString('en-US', { maximumFractionDigits: 0 });
        }

        return decimalPart !== undefined ? `${formattedInt}.${decimalPart}` : formattedInt;
    }

    /**
     * Handles incoming digit/decimal button or key input.
     * @param {string} val - Digit character ('0'-'9') or '.'
     */
    function handleInput(val) {
        // If calculator is in error state, reset first
        if (isErrorState) {
            clearCalculator();
        }

        // Reset current input buffer if flag was set by previous calculation or operator selection
        if (shouldResetDisplay) {
            currentInput = '';
            shouldResetDisplay = false;
        }

        // Handle decimal point logic
        if (val === '.') {
            if (currentInput.includes('.')) {
                // Prevent multiple decimals in the same number token
                return;
            }
            if (currentInput === '' || currentInput === '0') {
                currentInput = '0.';
                updateDisplay();
                return;
            }
        }

        // Handle leading zeros logic
        if (currentInput === '0' && val !== '.') {
            currentInput = val;
        } else {
            // Prevent input overflow beyond 16 characters
            if (currentInput.length < 16) {
                currentInput += val;
            }
        }

        updateDisplay();
    }

    /**
     * Handles operator actions (+, -, *, /).
     * Parses previous mathematical expression and chain operator evaluations.
     * @param {string} op - Mathematical operator symbol ('+', '-', '*', '/')
     */
    function handleOperator(op) {
        if (isErrorState) {
            clearCalculator();
            return;
        }

        const symbolMap = { '+': '+', '-': '−', '*': '×', '/': '÷' };
        const displayOp = symbolMap[op] || op;

        // If an operator was already typed and user clicks another operator before typing a new number
        if (shouldResetDisplay && pendingOperator && previousExpression !== '') {
            pendingOperator = op;
            // Replace the trailing operator in the previousExpression string
            previousExpression = previousExpression.slice(0, -2) + `${displayOp} `;
            updateDisplay();
            highlightActiveOperator(op);
            return;
        }

        // If there's an existing formula in progress, evaluate intermediate step
        if (previousExpression !== '' && pendingOperator && !shouldResetDisplay) {
            const success = executeIntermediateCalculation();
            if (!success) return;
        }

        pendingOperator = op;
        previousExpression = `${currentInput} ${displayOp} `;
        shouldResetDisplay = true;

        updateDisplay();
        highlightActiveOperator(op);
    }

    /**
     * Calculates the full expression when Equals (=) is triggered.
     */
    function calculate() {
        if (isErrorState) {
            clearCalculator();
            return;
        }

        // If no operator or expression is pending, return
        if (!pendingOperator || previousExpression === '') return;

        const exprParts = previousExpression.trim().split(' ');
        const firstNum = parseFloat(cleanNumberString(exprParts[0]));
        const secondNum = parseFloat(cleanNumberString(currentInput));
        const operator = pendingOperator;

        if (isNaN(firstNum) || isNaN(secondNum)) return;

        let result = 0;

        // Perform arithmetic calculation with precise operations
        switch (operator) {
            case '+':
                result = firstNum + secondNum;
                break;
            case '-':
                result = firstNum - secondNum;
                break;
            case '*':
                result = firstNum * secondNum;
                break;
            case '/':
                if (secondNum === 0) {
                    // Division by zero error handling
                    triggerError();
                    return;
                }
                result = firstNum / secondNum;
                break;
            default:
                return;
        }

        // Correct floating-point inaccuracies (e.g. 0.1 + 0.2 = 0.30000000000000004 -> 0.3)
        result = sanitizeFloatResult(result);

        const fullExpression = `${previousExpression}${currentInput} =`;
        const resultString = result.toString();

        // Record entry in calculation history
        addToHistory(fullExpression, resultString);

        // Update state
        previousExpression = fullExpression;
        currentInput = resultString;
        pendingOperator = null;
        shouldResetDisplay = true;

        // Animate result display
        currentInputEl.classList.add('flash-calc');
        setTimeout(() => currentInputEl.classList.remove('flash-calc'), 250);

        clearActiveOperators();
        updateDisplay();
    }

    /**
     * Intermediate math calculation for chained operations (e.g., 5 + 3 + 2).
     */
    function executeIntermediateCalculation() {
        const exprParts = previousExpression.trim().split(' ');
        const firstNum = parseFloat(cleanNumberString(exprParts[0]));
        const secondNum = parseFloat(cleanNumberString(currentInput));

        if (isNaN(firstNum) || isNaN(secondNum)) return false;

        let result = 0;
        switch (pendingOperator) {
            case '+': result = firstNum + secondNum; break;
            case '-': result = firstNum - secondNum; break;
            case '*': result = firstNum * secondNum; break;
            case '/':
                if (secondNum === 0) {
                    triggerError();
                    return false;
                }
                result = firstNum / secondNum;
                break;
        }

        result = sanitizeFloatResult(result);
        currentInput = result.toString();
        return true;
    }

    /**
     * Percentage calculation (%).
     * Converts current value to percentage (e.g., 50 -> 0.5) or proportional percentage.
     */
    function handlePercentage() {
        if (isErrorState) return;

        let val = parseFloat(cleanNumberString(currentInput));
        if (isNaN(val)) return;

        // If an expression exists (e.g. 100 + 10%), calculate 10% of 100
        if (pendingOperator && previousExpression !== '') {
            const exprParts = previousExpression.trim().split(' ');
            const baseNum = parseFloat(cleanNumberString(exprParts[0]));
            if (!isNaN(baseNum) && (pendingOperator === '+' || pendingOperator === '-')) {
                val = (baseNum * val) / 100;
            } else {
                val = val / 100;
            }
        } else {
            val = val / 100;
        }

        val = sanitizeFloatResult(val);
        currentInput = val.toString();
        updateDisplay();
    }

    /**
     * Toggles positive/negative sign (±).
     */
    function toggleSign() {
        if (isErrorState || currentInput === '0') return;

        if (currentInput.startsWith('-')) {
            currentInput = currentInput.slice(1);
        } else {
            currentInput = '-' + currentInput;
        }
        updateDisplay();
    }

    /**
     * Deletes the last character from current input (Backspace).
     */
    function deleteLast() {
        if (isErrorState) {
            clearCalculator();
            return;
        }

        if (shouldResetDisplay) return;

        if (currentInput.length > 1) {
            currentInput = currentInput.slice(0, -1);
            if (currentInput === '-') currentInput = '0';
        } else {
            currentInput = '0';
        }

        updateDisplay();
    }

    /**
     * Resets the entire calculator state to default (Clear / 'C').
     */
    function clearCalculator() {
        currentInput = '0';
        previousExpression = '';
        pendingOperator = null;
        shouldResetDisplay = false;
        isErrorState = false;
        clearActiveOperators();
        updateDisplay();
    }

    /**
     * Sets error state for invalid math operations (e.g. division by zero).
     */
    function triggerError() {
        isErrorState = true;
        currentInput = 'Error';
        previousExpression = '';
        pendingOperator = null;
        shouldResetDisplay = true;
        clearActiveOperators();
        updateDisplay();
    }

    // ----------------------------------------------------------------------
    // 5. HELPER MATH UTILITIES
    // ----------------------------------------------------------------------

    /**
     * Sanitizes JavaScript floating point calculation precision issues.
     * e.g. 0.1 + 0.2 = 0.30000000000000004 -> 0.3
     */
    function sanitizeFloatResult(num) {
        if (!isFinite(num)) return num;
        return parseFloat(num.toFixed(10));
    }

    function cleanNumberString(str) {
        return str.replace(/,/g, '');
    }

    function highlightActiveOperator(op) {
        clearActiveOperators();
        const btnMap = { '+': 'btn-add', '-': 'btn-subtract', '*': 'btn-multiply', '/': 'btn-divide' };
        const targetId = btnMap[op];
        if (targetId) {
            const btn = document.getElementById(targetId);
            if (btn) btn.classList.add('active-op');
        }
    }

    function clearActiveOperators() {
        const activeBtns = document.querySelectorAll('.btn-operator.active-op');
        activeBtns.forEach(btn => btn.classList.remove('active-op'));
    }

    // ----------------------------------------------------------------------
    // 6. EVENT HANDLERS & LISTENERS
    // ----------------------------------------------------------------------

    /**
     * Master keypad click listener using Event Delegation.
     */
    keypadGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn');
        if (!btn) return;

        createRippleEffect(e, btn);

        const action = btn.dataset.action;
        const val = btn.dataset.value;

        playClickSound(action === 'equals' ? 800 : 600);

        if (val && !action) {
            handleInput(val);
        } else if (action === 'operator') {
            handleOperator(val);
        } else if (action === 'clear') {
            clearCalculator();
        } else if (action === 'delete') {
            deleteLast();
        } else if (action === 'percent') {
            handlePercentage();
        } else if (action === 'negate') {
            toggleSign();
        }
    });

    /**
     * Dedicated Event Listener for the Equals (=) button as requested.
     */
    equalsBtn.addEventListener('click', () => {
        calculate();
    });

    /**
     * Handles keyboard events for physical input controls.
     * Supports digits 0-9, operators +, -, *, /, Enter, =, Backspace, Escape, %.
     */
    function handleKeyboardInput(e) {
        // Prevent default browser shortcuts for keys used in calculation
        const key = e.key;

        let targetBtn = null;

        if (key >= '0' && key <= '9') {
            handleInput(key);
            targetBtn = document.getElementById(`btn-${key}`);
        } else if (key === '.') {
            handleInput('.');
            targetBtn = document.getElementById('btn-decimal');
        } else if (key === '+' || key === '-' || key === '*' || key === '/') {
            handleOperator(key);
            const keyMap = { '+': 'btn-add', '-': 'btn-subtract', '*': 'btn-multiply', '/': 'btn-divide' };
            targetBtn = document.getElementById(keyMap[key]);
        } else if (key === 'Enter' || key === '=') {
            e.preventDefault();
            calculate();
            targetBtn = equalsBtn;
        } else if (key === 'Backspace') {
            e.preventDefault();
            deleteLast();
            targetBtn = document.getElementById('btn-delete');
        } else if (key === 'Escape' || key.toLowerCase() === 'c') {
            e.preventDefault();
            clearCalculator();
            targetBtn = document.getElementById('btn-clear');
        } else if (key === '%') {
            handlePercentage();
            targetBtn = document.getElementById('btn-percent');
        }

        // Add visual active feedback on corresponding screen button when keyboard is used
        if (targetBtn) {
            targetBtn.classList.add('pressed');
            playClickSound(targetBtn === equalsBtn ? 800 : 550);
            setTimeout(() => targetBtn.classList.remove('pressed'), 150);
        }
    }

    window.addEventListener('keydown', handleKeyboardInput);

    // ----------------------------------------------------------------------
    // 7. VISUAL RIPPLE & UTILITY PANEL LOGIC
    // ----------------------------------------------------------------------

    function createRippleEffect(event, button) {
        const circle = document.createElement('span');
        const diameter = Math.max(button.clientWidth, button.clientHeight);
        const radius = diameter / 2;
        const rect = button.getBoundingClientRect();

        circle.style.width = circle.style.height = `${diameter}px`;
        circle.style.left = `${event.clientX - rect.left - radius}px`;
        circle.style.top = `${event.clientY - rect.top - radius}px`;
        circle.classList.add('ripple');

        const existingRipple = button.querySelector('.ripple');
        if (existingRipple) existingRipple.remove();

        button.appendChild(circle);
    }

    // Toggle Sound Button
    soundToggleBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundOnIcon.classList.toggle('hidden', !soundEnabled);
        soundOffIcon.classList.toggle('hidden', soundEnabled);
        if (soundEnabled) playClickSound(700, 0.05);
    });

    // Toggle History Panel
    historyToggleBtn.addEventListener('click', () => {
        historyPanel.classList.toggle('active');
        playClickSound(650);
    });

    // Clear History Button
    clearHistoryBtn.addEventListener('click', () => {
        calculationHistory = [];
        renderHistoryUI();
        playClickSound(400);
    });

    // Click on history item to recall result
    historyList.addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (!item) return;

        const resVal = item.dataset.result;
        if (resVal) {
            currentInput = resVal;
            shouldResetDisplay = true;
            isErrorState = false;
            updateDisplay();
            historyPanel.classList.remove('active');
            playClickSound(700);
        }
    });

    function addToHistory(expr, res) {
        calculationHistory.unshift({ expr, res });
        if (calculationHistory.length > 20) calculationHistory.pop(); // keep last 20 entries
        renderHistoryUI();
    }

    function renderHistoryUI() {
        if (calculationHistory.length === 0) {
            historyList.innerHTML = `<li class="history-empty">No history yet. Start calculating!</li>`;
            return;
        }

        historyList.innerHTML = calculationHistory.map(item => `
            <li class="history-item" data-result="${item.res}">
                <span class="history-item-expr">${item.expr}</span>
                <span class="history-item-res">${formatDisplayValue(item.res)}</span>
            </li>
        `).join('');
    }

    // Initialize display on startup
    updateDisplay();
});
