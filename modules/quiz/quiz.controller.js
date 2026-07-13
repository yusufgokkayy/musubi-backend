const catchAsync = require('../../utils/catchAsync');
const QuizService = require('./quiz.service');

const QuizController = {
    start: catchAsync(async (req, res) => {
        const { type, jlptLevel } = req.body;
        try {
            const result = await QuizService.start(req.user.id, { type, jlptLevel });
            res.status(200).json({ success: true, data: result });
        } catch (err) {
            // Cooldown hatasında UI'ın geri sayım gösterebilmesi için tarihi de dön
            if (err.nextAttemptAllowedAt) {
                return res.status(err.statusCode || 403).json({
                    success: false,
                    message: err.message,
                    nextAttemptAllowedAt: err.nextAttemptAllowedAt
                });
            }
            throw err;
        }
    }),

    answerQuestion: catchAsync(async (req, res) => {
        const { index, answer } = req.body;
        const result = await QuizService.answerQuestion(req.user.id, req.params.id, index, answer);
        res.status(200).json({ success: true, data: result });
    }),

    getStatus: catchAsync(async (req, res) => {
        const result = await QuizService.getStatus(req.user.id);
        res.status(200).json({ success: true, data: result });
    })
};

module.exports = QuizController;
