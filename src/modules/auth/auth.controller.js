const { registerUser, loginUser } = require('./auth.service');

const register = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await registerUser(email, password);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login };
