const FPS = 30
const MS_PER_FRAME = 1000/FPS

let canvas;
let context;

function initializeGame() {
	canvas = document.getElementById("canvas")
	canvas.width = visualViewport.width
	canvas.height = visualViewport.height
	context = canvas.getContext('2d')
	document.addEventListener("touchstart", handleTouchstart)
	document.addEventListener("touchmove", handleTouchmove, { passive: false })
	startGame()
}

function handleTouchstart(e) {
	touch1.xPos = e.touches[0].clientX
	touch1.yPos = e.touches[0].clientY
	if (isObjectCloseToObject(touch1, SHIM, ball)) {
		isUserFlingingBall = true
	} else {
		athletes.blue.roster.push(
			{
				xPos: touch1.xPos,
				yPos: touch1.yPos
			}
		)
	}
}

function handleTouchmove(e) {
	e.preventDefault()
	let touch2 = {
		xPos: e.touches[0].clientX,
		yPos: e.touches[0].clientY
	}
	if (isUserFlingingBall == true) {
		ball.xVel = (touch2.xPos - touch1.xPos) / ball.flingDivisor
		ball.yVel = (touch2.yPos - touch1.yPos) / ball.flingDivisor
	}
}